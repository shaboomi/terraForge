# Convert an upstream generator plugin

TerraForge supports its existing single-file `.tf-plugin.js` format. Upstream
PR #128 uses a different folder-based renderer format. Their `apiVersion: 1`
values describe different contracts and do not make the files interchangeable.

An optional **offline developer tool** converts a small, explicit subset of
upstream generators into normal single-file TerraForge plugins. It does not
install or execute a folder plugin. Bitmap renderer folders cannot currently
be converted.

## Convert and install

From this repository's working folder, with Node installed:

```powershell
node scripts/convert-renderer-plugin.mjs C:\MyPlugins\spirograph C:\MyPlugins\spirograph.tf-plugin.js
```

The output must be a new `.tf-plugin.js` file outside the source folder. The
tool refuses to overwrite an existing file. Keep the source folder for future
editing and reconversion. The tool parses metadata and JavaScript syntax and
bundles source; it never evaluates plugin code during conversion.

Copy the output into the folder opened by **Plugins → Open Plugin Folder**,
then choose **Rescan plugins**. Find it under **Generators**. Review the code
and use **Preview** to inspect the artwork before applying it. Converted generators declare `previewRequired: true`; their Properties panel and run action require **Preview → Apply**. The resulting
artwork uses the usual saved settings, whole-result undo and update workflow.
Reopening a saved layout does not execute the converted plugin.

The converted ID is `converted.` followed by the upstream ID, for example
`converted.example.spirograph`. Its version is `1.0.0`: upstream manifests do
not declare a plugin version. The host's source fingerprint detects subsequent
converted-code/helper edits even when that version remains the same. Preserve
the converted ID to edit earlier results. Reconvert after changing any helper,
replace the installed output deliberately, then Rescan; saved artwork remains
until an explicit regeneration action.

## Supported subset

| Upstream feature | Conversion |
| --- | --- |
| `source: "none"` | Required. Uses the complete current page frame, in millimetres. |
| `render({width,height,scale,settings})` | `width`/`height` are page millimetres, `scale` is `1`, and `settings` contains validated declared controls. Host `seed` is also supplied. |
| CommonJS `module.exports.render` / `exports.render` | Compiled into static module functions. Module-level `this` is the initial `exports` object; failed `require()` calls discard the failed module and can be retried. No `eval` or `Function` is added to the sandbox policy. |
| Relative `.js` / `.json` helpers | Bundled into the single file; extensionless resolution tries exact, `.js`, `/index.js`, then `.json`. Relative `..` is allowed only within the bundle. Circular module references use normal partial CommonJS exports. |
| Number/input, number/slider, boolean, dropdown select | Translated to existing host-rendered controls. Every setting must have a declared field and valid default. |
| SVG path string | Exact line geometry: `M`, `L`, `H`, `V`, `Z`, their lowercase relatives, repeated arguments and finite exponent numbers. Coordinates must remain inside the page frame. |
| Array of `{d,label?,color?}` layers, or `{layers,warnings?}` | Separate structured vector items preserve labels, six-digit hex colours and warnings. No real pen ID or execution rank is invented. |
| `LICENSE` / `COPYING` files and inline comments | Retained in the generated file, including notices in helper subfolders. Check the source licence before redistributing it. |

Independent source units, margins, source-image placement, drawing origins or
machine commands are never inferred. The host handles artwork placement and
machine origins through its normal generator pipeline. The page is the
generator's full frame; resizing saved artwork scales its existing geometry.

The converter reads at most 64 regular source/notice files, 2 MiB of input,
six directory levels and 256 directories. Each directory is bounded to 1,024
entries. It rejects symbolic links and junctions, including links within the
folder, and checks file identity, size and containment around reads. Hidden
directories and `node_modules` are omitted. The generated file must satisfy
the existing 1 MiB plugin-file limit; metadata is bounded to 64 KiB.

## Explicit limitations

- `source: "required"` and `"optional"`, image tones, per-ink rendering and
  `inkOffset: true` are unsupported. The original RGBA/preparation contract
  remains the native TerraForge contract.
- SVG curves (`C`, `S`, `Q`, `T`, `A`), SVG markup/transforms/styles, dot
  objects, move-only pen taps and paths outside the frame fail with an
  explanation. No curve flattening, clipping or shape-to-tap conversion is
  guessed. Drawing after `Z` requires a new `M` in this subset.
- Numeric nudge presets, icon choices, accessibility overrides, undeclared
  defaults and unknown manifest fields fail conversion. A future extension
  can add them deliberately; they are not silently dropped.
- Upstream `renderTimeoutMs` is retained as conversion metadata and produces
  a conversion warning. Execution uses TerraForge's Standard or Extended
  host deadline and aggregate geometry limits. No plugin can raise them.
- Layer colours remain source colours. Assign real pens through TerraForge;
  colour resemblance does not establish a pen identity or plotting order.
- `__dirname`, `__filename`, Node packages, filesystem/network access, DOM,
  external imports and machine control are unavailable in the execution
  host. Conversion does not make downloaded JavaScript trustworthy.
- Source must parse under the strict mode inherited from the native ES
  module. The converter checks each module and the complete generated file
  without executing either. Sloppy-mode constructs are refused during
  conversion. Module-level `this` points to `exports`, unlike the reviewed
  upstream loader's global `this`; this converter does not emulate global
  variable creation or global-object access through module-level `this`.
- The tool checks syntax without evaluating the plugin. A syntactically
  valid generator can still fail, loop or use unsupported features when run;
  the existing isolated host, cancellation, deadline and result validation
  remain responsible for execution.

The actual upstream spirograph fixture and relative helper are covered by
conversion/execution tests. Full folder discovery, bitmap compatibility,
curve/dot support and runtime reuse are separate work. See the
[integration assessment](plugin-upstream-assessment.md) for the reviewed
upstream revision and design decisions.
