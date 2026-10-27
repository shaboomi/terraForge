import { Button } from "../ui";

interface ImportActionsProps {
  onImport: () => void;
  onOpenGcodeDialog: () => void;
  generating: boolean;
  importsEmpty: boolean;
  rasterOnly?: boolean;
}

export function ImportActions({
  onImport,
  onOpenGcodeDialog,
  generating,
  importsEmpty,
  rasterOnly = false,
}: ImportActionsProps) {
  return (
    <>
      <Button
        variant="secondary"
        onClick={onImport}
        title="Import an SVG, PDF, PNG, JPEG, or G-code file"
      >
        Import
      </Button>

      <Button
        variant="primary"
        onClick={onOpenGcodeDialog}
        disabled={generating || importsEmpty}
        loading={generating}
        title={rasterOnly ? "Bitmaps are reference images. Convert an image to vectors before generating G-code." : "Choose generation options then generate G-code"}
      >
        {generating ? "Generating…" : "Generate G-code"}
      </Button>
    </>
  );
}
