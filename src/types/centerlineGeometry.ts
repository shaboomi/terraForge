import type { FontOutlineCommand } from "./fonts";

/** A centreline stroke is one continuous, finite SVG subpath. */
export function validateCenterlineCommands(value: unknown, limit = 50_000): FontOutlineCommand[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > limit) throw new Error("Invalid centreline curve command count.");
  let closed = false;
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || closed) throw new Error("Invalid centreline curve command.");
    const command = entry as Record<string, unknown>;
    const fields = command.type === "M" || command.type === "L" ? ["x", "y"] : command.type === "Q" ? ["x1", "y1", "x", "y"]
      : command.type === "C" ? ["x1", "y1", "x2", "y2", "x", "y"] : command.type === "Z" ? [] : null;
    if (!fields || Object.keys(command).some(key => key !== "type" && !fields.includes(key)) ||
      (index === 0 ? command.type !== "M" : command.type === "M")) throw new Error("A centreline curve must contain one continuous stroke.");
    for (const key of fields) if (typeof command[key] !== "number" || !Number.isFinite(command[key]) || Math.abs(command[key] as number) > 1e9) throw new Error("Invalid centreline curve coordinate.");
    closed = command.type === "Z";
    return { ...command } as unknown as FontOutlineCommand;
  });
}

export function centerlinePathData(commands: FontOutlineCommand[]): string {
  return commands.map(command => {
    if (command.type === "Z") return "Z";
    if (command.type === "C") return `C${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`;
    if (command.type === "Q") return `Q${command.x1} ${command.y1} ${command.x} ${command.y}`;
    return `${command.type}${command.x} ${command.y}`;
  }).join(" ");
}
