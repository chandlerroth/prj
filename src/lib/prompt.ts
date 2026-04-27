import { blue, gray, colors } from "./colors.ts";

/**
 * Track whether any prompt has put the terminal into raw mode. If the
 * process exits abnormally (e.g. an unhandled rejection elsewhere) while a
 * masked prompt is active, the user could otherwise be left with a terminal
 * that has echo off — and the next thing they type (potentially a token)
 * would land in their shell history blind. Restoring on `exit` is cheap
 * insurance.
 */
let rawModeActive = false;
process.on("exit", () => {
  if (rawModeActive && process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch {}
  }
});

/**
 * Minimal line-buffered text prompt to stderr. Returns null on EOF/Ctrl+C.
 * Handles both TTY and piped input cleanly so callers don't have to.
 */
export async function promptText(
  label: string,
  opts: { mask?: boolean } = {},
): Promise<string | null> {
  process.stderr.write(label);
  const isTTY = !!process.stdin.isTTY;
  if (isTTY && opts.mask) {
    process.stdin.setRawMode(true);
    rawModeActive = true;
  }
  process.stdin.resume();

  return new Promise((resolve) => {
    let buf = "";
    const onData = (data: Buffer) => {
      const s = data.toString();
      for (const ch of s) {
        if (ch === "\x03") {
          cleanup();
          process.stderr.write("\n");
          return resolve(null);
        }
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stderr.write("\n");
          return resolve(buf);
        }
        if (ch === "\x7f" || ch === "\b") {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            if (opts.mask && isTTY) process.stderr.write("\b \b");
          }
          continue;
        }
        buf += ch;
        if (opts.mask && isTTY) process.stderr.write("*");
      }
    };
    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      if (isTTY && opts.mask) {
        process.stdin.setRawMode(false);
        rawModeActive = false;
      }
      process.stdin.pause();
    };
    process.stdin.on("data", onData);
  });
}

/** Yes/no confirmation. Returns false on Ctrl+C, EOF, or anything not y/yes. */
export async function confirm(label: string): Promise<boolean> {
  const ans = await promptText(label);
  if (ans === null) return false;
  const v = ans.trim().toLowerCase();
  return v === "y" || v === "yes";
}

interface SelectOption {
  label: string;
  value: string;
  hint?: string;
}

/**
 * Interactive select prompt with type-to-filter
 * All UI output goes to stderr, result goes to stdout
 */
export async function select(options: SelectOption[]): Promise<string | null> {
  if (options.length === 0) {
    return null;
  }

  let filter = "";
  let filtered = [...options];
  let selectedIndex = 0;
  // Use the full terminal height, reserving 2 lines (1 for filter, 1 for the
  // shell prompt that will redraw below the menu after we finish).
  const terminalRows = process.stderr.rows || process.stdout.rows || 24;
  const maxVisible = Math.min(Math.max(1, terminalRows - 2), options.length);
  // Reserve 1 extra line for the filter input
  const totalLines = maxVisible + 1;

  // Enable raw mode
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    rawModeActive = true;
  }
  process.stdin.resume();

  const getFiltered = (): SelectOption[] => {
    if (!filter) return [...options];
    const lower = filter.toLowerCase();
    return options.filter((opt) => opt.label.toLowerCase().includes(lower));
  };

  const render = () => {
    // Move up and clear all lines
    process.stderr.write(`\x1b[${totalLines}A\x1b[J`);

    // Render filter line
    if (filter) {
      process.stderr.write(`  ${gray("filter:")} ${filter}\n`);
    } else {
      process.stderr.write(`  ${gray("type to filter...")}\n`);
    }

    // Calculate scroll window
    const visibleCount = Math.min(maxVisible, filtered.length);
    let startIndex = 0;
    if (visibleCount > 0 && selectedIndex >= visibleCount) {
      startIndex = selectedIndex - visibleCount + 1;
    }
    const endIndex = Math.min(startIndex + visibleCount, filtered.length);

    // Render visible options
    for (let i = startIndex; i < endIndex; i++) {
      const opt = filtered[i];
      const prefix = i === selectedIndex ? blue(">") : " ";
      const label = i === selectedIndex ? blue(opt.label) : opt.label;
      const hint = opt.hint ? ` ${opt.hint}` : "";
      process.stderr.write(`${prefix} ${label}${hint}\n`);
    }

    // Fill remaining lines if filtered list is shorter
    for (let i = endIndex - startIndex; i < maxVisible; i++) {
      process.stderr.write("\n");
    }
  };

  // Initial render (blank lines first)
  for (let i = 0; i < totalLines; i++) {
    process.stderr.write("\n");
  }
  render();

  return new Promise((resolve) => {
    const onKeypress = (data: Buffer) => {
      const key = data.toString();

      // Ctrl+C or Escape
      if (key === "\x03" || key === "\x1b") {
        cleanup();
        resolve(null);
        return;
      }

      // Enter
      if (key === "\r" || key === "\n") {
        if (filtered.length > 0) {
          cleanup();
          resolve(filtered[selectedIndex].value);
        }
        return;
      }

      // Arrow up or Ctrl+P
      if (key === "\x1b[A" || key === "\x10") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        return;
      }

      // Arrow down or Ctrl+N
      if (key === "\x1b[B" || key === "\x0e") {
        selectedIndex = Math.min(filtered.length - 1, selectedIndex + 1);
        render();
        return;
      }

      // Backspace
      if (key === "\x7f" || key === "\b") {
        if (filter.length > 0) {
          filter = filter.slice(0, -1);
          filtered = getFiltered();
          selectedIndex = 0;
          render();
        }
        return;
      }

      // Printable characters (filter input)
      if (key.length === 1 && key >= " " && key <= "~") {
        filter += key;
        filtered = getFiltered();
        selectedIndex = 0;
        render();
        return;
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
        rawModeActive = false;
      }
      process.stdin.pause();
      // Clear the menu
      process.stderr.write(`\x1b[${totalLines}A\x1b[J`);
    };

    process.stdin.on("data", onKeypress);
  });
}
