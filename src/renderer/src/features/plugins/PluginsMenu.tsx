import { useEffect, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronRight, FolderOpen, Plus, Puzzle, Settings } from "lucide-react";
import { Button } from "../../components/ui";
import { PLUGIN_MENU_CATEGORIES, pluginsInCategory, type PluginMenuCategory } from "./pluginMenuGroups";
import { PluginManagement } from "./PluginManagement";
import { usePluginStore } from "./pluginStore";

const menuStyle = "z-70 rounded border border-border-ui bg-panel p-1 shadow-xl text-xs text-content outline-none overflow-y-auto overscroll-contain";
const itemStyle = "flex min-h-8 w-full items-center gap-2 rounded px-2 py-1.5 text-left select-none outline-none cursor-default data-[highlighted]:bg-secondary-hover data-[highlighted]:text-content data-[disabled]:text-content-faint";

export function PluginsMenu() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<PluginMenuCategory | null>(null);
  const [managing, setManaging] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const entries = usePluginStore((state) => state.entries);
  const loading = usePluginStore((state) => state.loading);
  const error = usePluginStore((state) => state.error);
  const refresh = usePluginStore((state) => state.refresh);
  const select = usePluginStore((state) => state.select);
  const openFolder = usePluginStore((state) => state.openFolder);
  const installExample = usePluginStore((state) => state.installExample);
  useEffect(() => { void refresh(); }, [refresh]);

  return <>
    <Menu.Root open={open} onOpenChange={(value) => { setOpen(value); if (!value) setCategory(null); }}>
      <Menu.Trigger asChild>
        <Button ref={trigger} icon={<Puzzle size={15} />}>Plugins</Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content aria-label="Plugins" align="start" sideOffset={6} collisionPadding={8} loop
          onKeyDown={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => { if (managing) event.preventDefault(); }}
          className={`${menuStyle} w-52 max-w-[calc(100vw-1rem)]`}
          style={{ maxHeight: "var(--radix-dropdown-menu-content-available-height)" }}>
          {PLUGIN_MENU_CATEGORIES.map(([id, label]) => {
            const group = pluginsInCategory(entries, id);
            return <Menu.Sub key={id} open={category === id} onOpenChange={(value) => {
              setCategory((current) => value ? id : current === id ? null : current);
            }}>
              <Menu.SubTrigger
                // Radix supplies a 300 ms pointer grace area between the two menus.
                // Open immediately on entry rather than waiting for its default hover timer.
                onPointerEnter={(event) => { if (event.pointerType === "mouse") setCategory(id); }}
                className={`${itemStyle} data-[state=open]:bg-secondary-hover data-[state=open]:text-content`}>
                <span className="flex-1">{label}</span><ChevronRight size={14} aria-hidden="true" />
              </Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent aria-label={label} sideOffset={2} collisionPadding={8} loop
                  onKeyDown={(event) => event.stopPropagation()}
                  className={`${menuStyle} w-72 max-w-[calc(100vw-1rem)]`}
                  style={{ maxHeight: "var(--radix-dropdown-menu-content-available-height)" }}>
                  {group.length === 0 && <p className="px-2 py-3 text-content-muted">{loading ? "Loading plugins…" : "No plugins installed in this category."}</p>}
                  {group.map((entry) => <Menu.Item key={entry.filename} textValue={entry.manifest!.name}
                    aria-label={entry.manifest!.name} disabled={!entry.enabled}
                    title={!entry.enabled ? "Enable this plugin in Manage Plugins." : entry.manifest!.description}
                    onSelect={() => { select(entry); setOpen(false); setCategory(null); window.dispatchEvent(new Event("terraforge:show-properties")); }}
                    className={`${itemStyle} flex-col items-start gap-0.5 break-words`}>
                    <span>{entry.manifest!.name}</span>
                    {entry.manifest!.input === "vector" && <span className="text-[10px] text-content-muted">Vector input</span>}
                    {!entry.enabled && <span className="text-[10px] text-content-muted">Disabled · Enable in Manage Plugins</span>}
                  </Menu.Item>)}
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>;
          })}
          <Menu.Separator className="my-1 h-px bg-border-ui" />
          <Menu.Item className={itemStyle} onSelect={() => void openFolder()}><FolderOpen size={14} aria-hidden="true" />Open Plugin Folder</Menu.Item>
          <Menu.Item className={itemStyle} disabled={loading} onSelect={() => void installExample()}><Plus size={14} aria-hidden="true" />Add Example Generator</Menu.Item>
          <Menu.Item className={itemStyle} onSelect={() => setManaging(true)}><Settings size={14} aria-hidden="true" />Manage Plugins</Menu.Item>
          {loading && <p role="status" className="px-2 py-1 text-content-muted">Loading plugins…</p>}
          {error && <p role="alert" className="px-2 py-1 text-accent break-words">{error}</p>}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
    <PluginManagement open={managing} onOpenChange={setManaging} onClose={() => trigger.current?.focus()} />
  </>;
}
