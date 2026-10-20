import type { Msg } from "./model.js";

export interface KeyPress {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

export function keyToMsg(str: string | undefined, key: KeyPress | undefined): Msg | null {
  if (key?.ctrl && key.name === "c") return { type: "quit" };

  switch (key?.name) {
    case "up":
      return { type: "move", delta: -1 };
    case "down":
      return { type: "move", delta: 1 };
    case "return":
    case "enter":
      return { type: "trigger" };
    default:
      break;
  }

  switch (str?.toLowerCase()) {
    case "k":
      return { type: "move", delta: -1 };
    case "j":
      return { type: "move", delta: 1 };
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
    default:
      return null;
  }
}
