import * as fs from "fs";
import * as path from "path";
import * as htmlMinifier from "html-minifier";

/** Options to be passed to the `renderAsync` method */
export interface RenderOptions {
    /** Indicates whether to minify the rendered HTML, defaults to true */
    minify?: boolean;

    /** Options to pass to the HTML minifier (NPM package `html-minifier`) */
    htmlMinifierOptions?: htmlMinifier.Options;
}

/** Default options for the HTML minifier (NPM package `html-minifier`) */
export const defaultHtmlMinifierOptions: htmlMinifier.Options = {
    minifyCSS: true,
    minifyJS: true,
    caseSensitive: true,
    collapseBooleanAttributes: true,
    removeAttributeQuotes: true,
    removeComments: true,
    collapseWhitespace: true,
    conservativeCollapse: true
};

// AsyncFunction constructor (not a global)
const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;

// helper function to escape HTML's special characters
const _toHtml = (s: string) => String(s).replace(/&/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");

// template cache used by Template.fromFile (NOT for partials)
const _fileTemplateCache: { [fileName: string]: Template } = {};

export class Template {
    /** Create a new template instance with source text from given file (loaded and compiled asynchronously) */
    public static fromFile(fileName: string, ignoreCache?: boolean) {
        let absolutePath = path.resolve(fileName);
        if (!ignoreCache && _fileTemplateCache[absolutePath]) {
            // already compiled this file before
            return _fileTemplateCache[absolutePath];
        }

        // read the file, and compile its contents now
        let srcP = new Promise<string>((resolve, reject) => {
            fs.readFile(absolutePath, (err, data) => {
                if (err) reject(err);
                else resolve(data.toString());
            });
        });
        let template = new Template(srcP, absolutePath);

        if (!ignoreCache) _fileTemplateCache[absolutePath] = template;
        return template;
    }

    /** Create a new template instance with given source text and optional filename */
    constructor(text: string | Promise<string>, fileName?: string) {
        this._srcP = (typeof (<any>text).then === "function") ?
            text as Promise<string> : Promise.resolve(text);
        this._fileName = fileName;
    }

    /** Render this template using the given context object; returns a (promise for) the rendered output string */
    public async renderAsync(context: any = {}, options?: RenderOptions) {
        if (!this._compiledP) this._compiledP = this._compileAsync();
        let result = await (await this._compiledP)(context);

        if (!options || options.minify !== false) {
            // minify the HTML using given options, if any
            let minOptions = options && options.htmlMinifierOptions || 
                defaultHtmlMinifierOptions;
            result = htmlMinifier.minify(result, minOptions);
        }
        return result;
    }

    /** Compile the template source into a function */
    private async _compileAsync(partials: { [fileName: string]: Template } = {}) {
        // initialize function name and partials if needed
        let name = "T_" + (this._fileName || "untitled").replace(/[^A-Za-z0-9_]/g, "_");

        // start with empty _$out variable, then add all content and scripts
        let code = `let _$out = "";`;
        let src = await this._srcP;
        let parts = src.split(/(\<\/?\s*(?:script|template)(?:\s(?:[^\>\"]|\"[^\"]*\")*)?\>)/);
        let nesting: string[] = [], closeCode: string[] = [];
        let definedInner: string[] = [];
        let callTempVarN = 0;
        let escOutput = (s: string) => s.replace(/([\\$`])/g, "\\$1");
        while (parts.length) {
            let p = parts.shift()!;

            // check for <script> tags and read all of their content unprocessed
            if (/^\<\s*script.*\>/.test(p)) {
                let openTag = p;
                let scriptContent = "";
                while (parts.length && !/^\<\/\s*script/.test(parts[0])) {
                    scriptContent += parts.shift();
                }
                let closeTag = parts.shift();

                // add "in-template" script to function directly, or add it to the HTML
                if (/\s+in-template\W/.test(openTag)) {
                    code += scriptContent + (scriptContent.endsWith(";") ? "" : ";");
                }
                else {
                    code += "_$out += `" +
                        escOutput(openTag + scriptContent + (closeTag || "")) + "`;";
                }
                continue;
            }

            // check for <template ...> and </template> tags
            if (/^\<\/?\s*template.*\>$/.test(p)) {
                if (p[1] === "/") {
                    // close last template tag
                    if (!nesting.length) {
                        let line = code.split(/\n\r|\r\n|\n|\r/).length;
                        throw new Error("Unexpected </template> on line " + line);
                    }
                    nesting.pop();
                    code += closeCode.pop();
                    continue;
                }

                // increase nesting level, look for attributes
                nesting.push(p);
                closeCode.push("");
                let regex = /(\s+|[a-z]+\s*=\s*\"[^\"]*\")/;
                let parts = p.split(regex).map(q => q.trim()).slice(1);
                let selfClosing = (parts.pop() === "/>");
                let partialPath = "", partialContext;
                let callExpr: string | undefined;
                let getAttr = (s: string, noBraces?: boolean) => {
                    let attr = s.slice(0, -1).replace(/^[^\"]*\"/, "");
                    return (!noBraces && /^{{((?:[^}]|}[^}])+)}}$/.test(attr)) ?
                        attr.slice(2, -2) : attr;
                }
                for (let q of parts) {
                    if (!q) continue;
                    let attrMatch = q.match(/^([a-z]+)\s*=.*\"$/);
                    let attrName = attrMatch && attrMatch[1];
                    switch (attrName) {
                        case "if":
                        case "for":
                        case "while":
                            closeCode.push("}" + closeCode.pop());
                            code += attrName + " (" + getAttr(q).trim() + ") {";
                            break;
                        case "html":
                            code += "_$out += (" + getAttr(q).trim() + ");";
                            break;
                        case "use":
                            callExpr = getAttr(q).trim();
                            break;
                        case "context":
                            partialContext = getAttr(q).trim();
                            break;
                        case "partial":
                        case "wrap":
                            partialPath = getAttr(q, true).trim();
                            break;
                        case "define":
                            let fnName = getAttr(q, true).trim();
                            if (!/^[a-zA-Z_]\w*$/.test(fnName))
                                throw new Error("Invalid function name: " + fnName);
                            definedInner.push(fnName);
                            code += `async function ${fnName}(context) { let _$out = "";` +
                                "with(context) {";
                            closeCode.push("} return _$out; };" + closeCode.pop());
                            break;
                        default:
                            let line = code.split(/\n\r|\r\n|\n|\r/).length;
                            throw new Error("Unexpected: " + q + " at line " + line);
                    }
                }

                // add code for call expression, if any
                if (callExpr) {
                    let callFn = "_$f" + callTempVarN++;
                    if (selfClosing) {
                        if (!partialContext) {
                            // add empty content property to copy of context
                            partialContext = `Object.assign({content: ""}, context)`;
                        }

                        // add function output directly
                        code += `let ${callFn} = (${callExpr});` +
                            `_$out += (typeof ${callFn} === "function") ? ` +
                            `await ${callFn}(${partialContext}) : "";`;
                    }
                    else {
                        // pass content if no context is given
                        if (!partialContext) {
                            partialContext = `Object.assign({content: _$out}, context)`;
                        }

                        // wrap in function and add partial output in the end
                        code += `_$out += await (async ()=>{ let _$out = "";`;
                        closeCode.push(`let ${callFn} = (${callExpr});` +
                            `return (typeof ${callFn} === "function") ? ` +
                            `await ${callFn}(${partialContext}) : ""; })();` +
                            closeCode.pop());
                    }
                }

                // add code for inclusion of partial, if any
                if (partialPath) {
                    // check if current file has a name in the first place
                    if (!this._fileName) {
                        throw new Error("Cannot include partial: no file name");
                    }

                    // create another template instance for (async) file contents
                    let fullPath = path.join(path.dirname(this._fileName), partialPath);
                    if (!partials[fullPath]) {
                        let fileContentsP = new Promise<string>((resolve, reject) => {
                            fs.exists(fullPath, exists => {
                                if (!exists) fullPath += ".html";
                                fs.readFile(fullPath, (err, data) => {
                                    if (err) reject(err);
                                    else resolve(data.toString());
                                });
                            });
                        });
                        let partial = new Template(fileContentsP, fullPath);
                        partials[fullPath] = partial;
                        partial._compiledP = partial._compileAsync(partials);
                    }
                    if (selfClosing) {
                        // use a copy of the context if no context is given
                        if (!partialContext) {
                            partialContext = `Object.assign({content: ""}, context)`;
                        }

                        // add partial output directly
                        code += "_$out += await _$partials[" +
                            JSON.stringify(fullPath) +
                            "].renderAsync(" + partialContext + ");";
                    }
                    else {
                        // pass content and all defined functions if no context is given
                        if (!partialContext) {
                            partialContext = "{" +
                                definedInner.map(name => name + ",").join("") +
                                "content: _$out}";
                        }

                        // wrap in function and add partial output in the end
                        code += `_$out += await (async ()=>{ let _$out = "";`;
                        closeCode.push("return await _$partials[" +
                            JSON.stringify(fullPath) +
                            "].renderAsync(" + partialContext + ")})();" +
                            closeCode.pop());
                    }
                }

                // reduce nesting level again if tag was self-closing
                if (selfClosing) {
                    nesting.pop();
                    code += closeCode.pop();
                }
                continue;
            }

            // literal HTML: escape special characters and add to output
            p = escOutput(p).replace(/{{((?:[^}]|}[^}])+)}}/g, "$${_$$toHtml($1)}");
            code += "_$out += `" + p + "`;";
        }

        // check nesting level: error if still nested
        if (nesting.length) {
            throw new Error("Expected </template> for matching " + nesting.pop());
        }

        // create eval-able function code
        code = "with (context) {" + code + "; return _$out}";
        let str = JSON.stringify("(async function " + name + "(context) {" + code + "})");

        // escape strict mode using Function constructor, then return async function
        let resultF = new Function("_$partials", "_$toHtml", "return eval(" + str + ")");
        return resultF(partials, _toHtml) as (ctx: any) => Promise<string>;
    }

    private _srcP: Promise<string>;
    private _fileName?: string;
    private _compiledP: Promise<(ctx: any) => Promise<string>>;
}
