# Async HTML Template Engine

A simple asynchronous (using async/await) HTML template engine, for use with Express or as a standalone HTML generator.

> **Note:** this module is ONLY for use with NodeJS 8+ (for native async/await), and does NOT work in the browser.

## Usage (Express)

Register the view engine as follows:

```javascript
app.engine("html", require("async-html-template").AsyncHtmlViewEngine);
app.set("view engine", "html");
```

(or, in TypeScript) --

```typescript
import { AsyncHtmlViewEngine } from "async-html-template";
app.engine("html", AsyncHtmlViewEngine);
app.set("view engine", "html");
```

Then, use Express views to render content:

```javascript
app.get("/", (req, res) => {
    res.render("index", { title: "Hello, world!" });
})
```

## Standalone Usage

You can also use the template engine without Express.

For simple one-off transforms, use the exported `renderAsync` and `renderFileAsync` functions:

* `renderAsync(templateText, context)` returns a Promise for rendered HTML based on given template string and context object.
* `renderFileAsync(fileName, context)` returns a Promise for rendered HTML based on the template in the given file and with the given context object.

The exported `Template` class can be used directly as well. It encapsulates an asynchronously compiled function that efficiently generates HTML output for a given context object.

```javascript
// render a template from a file:
let fileTemplate = Template.fromFile("./index.html");
let fileResult = await fileTemplate.renderAsync({ title: "Hello, world!" });

// render a template from a string:
let str = `<h1>{{ title }}</h1>`;
let strTemplate = new Template(str);
let strResult = await strTemplate.renderAsync({ title: "Hello, world!" });
```

## Optimization

Templates that are generated by `renderFileAsync` and `Template.fromFile` (but NOT the partials included by any of these templates) are automatically _cached_, so that files are generally only read and compiled only once.

The resulting HTML is never cached, even for the same context object.

By default, HTML output is minified and comments are removed (using the NPM package `html-minifier`). You can supply minification options to the `renderAsync` method of the `Template` class, _or_ use the exported `defaultHtmlMinifierOptions` object which contains default options.

## Templates

A template is basically just (partial) HTML, with added code that runs while rendering the template.

### Expression Tags

Tags that look like `{{ ... }}` contain JavaScript expressions that are evaluated while rendering. For each tag, the result is HTML-encoded and inserted in place of the tag.

As part of the expression, you can use properties from the context object (passed in through Express `.render`, or any of the `Template` rendering methods), as if they are variables. Alternatively you can use the `context` object explicitly, e.g. if a property is masked by a local variable or if its name is a reserved word.

```html
<h1>Hello, {{ firstName }}</h1>
<p>Your case number is {{ context.case.getNumber() }}</p>
```

Use the `<template html="...">` tag described below if you do not want the result of an expression to be HTML-encoded.

### Template Script Code

Any script code inside of a script tags that contains the `in-template` attribute is not copied to the output, but is run while rendering instead.

You can use properties from the context object in template script code as well.

```html
<script in-template>
    let result = [];
    for (let i = 0; i < firstName.length; i++) {
        result.push(firstName.charCodeAt(i));
    }
</script>
<p>Your name in Unicode is {{ JSON.stringify(result) }}</p>
```

### Loops

Wrap a part of your template in a `<template for="...">` ... `</template>` tag to add a for-loop around the wrapped area of your template, with exactly the same syntax as in JavaScript.

```html
<!-- A traditional for-loop: -->
<div>
    <template for="{{ var i = 1; i <= 10; i++ }}">
        <span>{{ i }}</span>
    </template>
</div>

<!-- An object for-in loop: -->
<div>
    <template for="{{ var property in person.attributes }}">
        <span><b>{{ property }}:</b> {{ person.attributes[property] }}</span>
    </template>
</div>

<!-- A modern for-of loop over an array: -->
<div>
    <script in-template>
        var fib = [1, 1, 2, 3, 5, 8, 13, 21];
    </script>
    <template for="{{ var n of fib }}">
        <span>{{ n }}</span>
    </template>

    <!-- or even: -->
    <template for="{{ var [index, n] of fib.entries() }}">
        <span>{{ n }} ({{ index }})</span>
    </template>
</div>
```

For a while-loop, you can use the `<template while="...">` tag.

```html
<p>
    Fib in reverse is
    <template while="{{ fib.length }}"> {{ fib.pop() }} </template>
</p>
```

### Conditionals

Wrap a part of your template in a `<template if="...">` ... `</template>` tag to check if a condition is true _while rendering_, and skip rendering the wrapped area if not.

```html
<div>
    <template if="{{ person.children && person.children.length }}">
        <h2>Children</h2>
        <template for="{{ let child of person.children }}">
            <p>Name: {{ child.name }}</p>
        </template>
    </template>
</div>
```

Optionally, you can leave out the braces from the value of the `if` attribute (i.e. `if="expression"`) for exactly the same result.

You can also combine conditionals with loops in the same `<template ...>` tag.

```html
<div>
    <template if="{{ person.hasChildren() }}" for="{{ let child of person.getChildren() }}">
        <p>Child: {{ child.name }}</p>
    </template>
</div>
```

### Literal HTML Output

For an expression that returns HTML which should be appended literally (instead of being HTML-encoded), you can use the `<template html="...">` tag.

This tag does _not_ wrap the output in a surrounding tag.

```html
<script in-template>
    let myHtml = "<b>Hello</b>";
</script>
<p>This is HTML-encoded: {{ myHtml }}</p>
<p>This is not: <template html="{{ myHtml }}" /></p>
```

### Reusable Templates (Mixin Functions)

Using the `<template define="...">` tag, you can define a named template (sometimes called a 'mixin' function) that can be used multiple times throughout the rest of your template. This does in fact define an (asynchronous) function within the compiled template, which can be passed around and called using its identifier.

To make it easier to call functions defined in this way, you can use the `<template use="...">` tag. If you include any content within this tag, the resulting HTML will be passed to the defined function in a `content` property (also available as `context.content`).

```html
<!-- Define a reusable function: -->
<template define="timedDiv">
    <div data-timestamp="{{ new Date().getTime() }}">
        <template html="{{ content }}" />
    </div>
</template>

<!-- Call the function twice: -->
<template use="timedDiv" />
<script in-template>
    await new Promise(r => setTimeout(r, 1000));
</script>
<template use="timedDiv">
    <p>One second later.</p>
</template>
```

Alternatively, you can pass in a different context object, using the `context="..."` attribute. The result of the expression is used as the function's context.

```html
<template define="sayHi">Hello, {{ name }}!</template>

<template use="sayHi" context="{{ {name: 'world'} }}" />
<!-- this is the same as: -->
<template html="{{ await sayHi({ name: 'world' }) }}" />
```

### Partial Includes

You can include (partial) HTML templates from other files using the `<template partial="...">` tag. Any given file name is considered to be relative to the current file -- so this only works if the template is loaded from a file in the first place (i.e. not using the `renderAsync(templateText, context)` function, for example).

This tag can also be combined with conditionals or loops, which causes the partial template to be evaluated repeatedly and/or conditionally.

If you need the partial template to be rendered with a different context object, you can provide the `context="..."` attribute. The result of the expression is used as the partial template's context, which can be different for each iteration of a combined loop (if any).

If you do not specify a context expression, a shallow clone of the current context object will be used as the context for the included partial, along with wrapped HTML content (if any) in the `content` property.

```html
<!-- Always included, cloned context -->
<template partial="always.html" />

<!-- Conditionally included, different context -->
<template if="{{ !!supervisor }}" partial="super.html" context="{{ supervisor.getData() }}">

<!-- Loop with different context for each iteration -->
<template for="{{ let child of person.children }}" partial="child.html" context="{{ child }}">
```

Note that any _variables_ set in the current template scope (i.e. using `let` or `var`) are not available to the partial template. You **can** set properties of the `context` object, which will also be available to partial templates with the same context:

```html
<template for="{{ let child of person.children }}">
    <script in-template>
        // add current child to context object
        context.child = child;
    </script>
    <template partial="child.html">
</template>
```

Just like with template functions defined using `<template define="...">`, you can pass contained content along to the partial template. The content will end up in the `content` property of the partial's context. For this reason, the `partial` attribute is also aliased as `wrap`, since it can be used to wrap sections into an outer 'template'.

Any functions defined in your containing code up to the point of the `<template wrap="...">` tag will also be passed to the partial template (unless you explicity specify another context object). These functions can be used by the partial template using the `<template use="...">` tag.

```html
<!-- inner.html -->
<template define="scripts">
    <script>console.log("foo")</script>
</template>
<template wrap="outer.html">
    <h1>Content</h1>
    <p>Lorem ipsum.</p>
</template>

<!-- outer.html -->
<article>
    <template html="content" />
    <template use="context.scripts" />
    <template use="context.styles" /> <!-- ignored -->
</article>
```

## Asynchronous Code

Because of the asynchronous nature of this template engine, you can actually include `await` expressions in your template code. This is really helpful if your (view) model has `async` features, which can be consumed directly by the template, instead of having to `await` any data that is used inside of your template.

Given a model that looks like this:

```typescript
export class WaitForIt {
    static async getSomeDataAsync() {
        // do something useful here, like loading data from a server...
        await new Promise(res => setTimeout(res, 1000));
        return { foo: ["Bar", "Baz", "Quux"] };
    }
}
```

You can use `await` expressions for this model's results directly in a template:

```html
<div>
    <!-- Either in a script block: -->
    <script in-template>
        let data = await WaitForIt.getSomeDataAsync();
    </script>
    <template for="let name of data.foo">
        <span>{{ name }}</span>
    </template>

    <!-- Or even directly in a for loop: -->
    <template for="let name of (await WaitForIt.getSomeDataAsync()).foo">
        <span>{{ name }}</span>
    </template>
</div>
```
