import * as fs from "fs";
import { Template } from "./Template";

// export Template type itself
export * from "./Template";

// check if file=>template cache should be enabled
const IS_PROD = String(process.env.NODE_ENV).toLowerCase() === "production";

/** Express-compatible view engine function; used as `app.engine("html", AsyncHtmlViewEngine)` and `app.set("view engine", "html")` */
export function AsyncHtmlViewEngine(fileName: string, options: any, callback: Function) {
    Template.fromFile(fileName, !IS_PROD).renderAsync(options)
        .then(result => { callback(undefined, result) })
        .catch(err => { callback(err) });
}

/** Shortcut function that quickly renders a given template file with given context, and returns a (promise for a) HTML string; same as `Template.fromFile(...).renderAsync(...)` */
export async function renderFileAsync(fileName: string, context?: any) {
    return await Template.fromFile(fileName, !IS_PROD).renderAsync(context);
}

/** Shortcut function that quickly renders a given template string with given context, and returns a (promise for a) HTML string; same as `new Template(...).renderAsync(...)` */
export async function renderAsync(templateText: string, context?: any) {
    return await new Template(templateText).renderAsync(context);
}
