# Rescan and saved plugin code

Choose **Plugins → Rescan Plugins** after adding, editing or removing a `.tf-plugin.js` file. The same action is available in **Manage Plugins**. Discovery reads and validates the JSON header without executing the module. Invalid files are listed with a reason; duplicate IDs disable every duplicate until corrected. Files are listed in filename order. A failed whole-folder scan keeps the previous list.

Rescan cancels running computations and discards temporary previews, including unchanged plugins. Run Preview again before Apply. Installed artwork is never replaced by scanning. Enable/disable choices follow the stable plugin ID and survive removal and reinstallation. The preferences file remains bounded.

Each discovered executable has a SHA-256 fingerprint of its complete UTF-8 source, including the header. Running checks the file against this snapshot; an edited file requires another explicit Rescan. A request also pins the fingerprint, so a result cannot be applied after the installed code changes. Self-contained files have no external helper dependencies; the generator conversion tool embeds its supported helper modules in the executable.

New results save the fingerprint alongside the plugin version, settings, seed and source reference. **Edit with** explains when the installed source differs even though its version is unchanged. Opening controls, opening a layout and scanning never regenerate geometry. Choose **Update artwork** explicitly; processors still require **Preview → Update artwork**. Updates retain result identities and remain one undo step. A different declared version retains the existing compatibility refusal.

Older layouts without a fingerprint still open and remain editable when their declared version/settings/source are compatible. Properties explains that their original code cannot be verified. Their next explicit regeneration records the current fingerprint. Saved vectors and bitmaps remain usable when the plugin is missing or disabled.

This stage retains the existing categories, real-pen assignments and plotting order, Standard/Extended capacities, isolated fresh runtimes, deadlines, full source frames and portable saves. It adds no machine-control API.
