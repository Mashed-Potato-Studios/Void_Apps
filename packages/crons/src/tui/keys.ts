import type { Msg } from "./model.js";

export interface KeyPress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

export function keyToMsg(
  str: string | undefined,
  key: KeyPress | undefined,
  filterInput = false,
): Msg | null {
  if (key?.ctrl && key.name === "c") return { type: "quit" };

  if (filterInput) {
    if (key?.name === "escape") return { type: "filter-clear" };
    if (key?.name === "return" || key?.name === "enter") return { type: "filter-apply" };
    if (key?.name === "backspace" || key?.name === "delete") return { type: "filter-backspace" };
    if (str !== undefined && /^[ -~]$/.test(str) && !key?.ctrl && !key?.meta) {
      return { type: "filter-char", char: str };
    }
    return null;
  }

  if (key?.name === "escape") return { type: "escape" };

  switch (key?.name) {
    case "up":
      return { type: "move", delta: -1 };
    case "down":
      return { type: "move", delta: 1 };
    case "pageup":
      return { type: "move-page", direction: -1 };
    case "pagedown":
      return { type: "move-page", direction: 1 };
    case "home":
      return { type: "move-to", position: "first" };
    case "end":
      return { type: "move-to", position: "last" };
    case "f1":
      return { type: "help-toggle" };
    case "return":
    case "enter":
      return { type: "trigger" };
    default:
      break;
  }

  // Vim-style jumps are case-sensitive; the rest of the keymap is not.
  if (str === "g") return { type: "move-to", position: "first" };
  if (str === "G") return { type: "move-to", position: "last" };
  if (str === "Q") return { type: "pane-toggle" };

  switch (str?.toLowerCase()) {
    case "k":
      return { type: "move", delta: -1 };
    case "j":
      return { type: "move", delta: 1 };
    case "s":
      return { type: "loop-toggle" };
    case "/":
      return { type: "filter-open" };
    case "o":
      return { type: "sort-cycle" };
    case "v":
      return { type: "detail-toggle" };
    case "d":
      return { type: "toggle" };
    case "e":
      return { type: "emit" };
    case "c":
      return { type: "catchup" };
    case "r":
      return { type: "refresh" };
    case "q":
      return { type: "quit" };
    case "?":
      return { type: "help-toggle" };
    default:
      return null;
  }
}
