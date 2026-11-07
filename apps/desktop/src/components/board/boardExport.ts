import type { BoardDocument, BoardObject } from "@locus/shared";
import { downloadTextFile, printHtmlDocument } from "@/lib/chatExport";

const STICKY: Record<string, string> = {
  amber: "#f5d48a",
  mint: "#b7e0c3",
  sky: "#b7d4ea",
  rose: "#f0c1c8",
  violet: "#d4c2ea",
  paper: "#f4efe6",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bounds(objects: BoardObject[]): { x: number; y: number; w: number; h: number } {
  const boxes = objects.filter((row) => row.type !== "connector");
  if (!boxes.length) return { x: 0, y: 0, w: 800, h: 600 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const row of boxes) {
    minX = Math.min(minX, row.x);
    minY = Math.min(minY, row.y);
    maxX = Math.max(maxX, row.x + row.w);
    maxY = Math.max(maxY, row.y + row.h);
  }
  const pad = 40;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

function objectCenter(objects: BoardObject[], id?: string): { x: number; y: number } | undefined {
  const row = objects.find((item) => item.id === id);
  if (!row) return undefined;
  return { x: row.x + row.w / 2, y: row.y + row.h / 2 };
}

export function exportBoardJson(board: BoardDocument): void {
  downloadTextFile(JSON.stringify(board, null, 2), `${slug(board.title)}.json`, "application/json");
}

export function exportBoardPng(board: BoardDocument, frameId?: string): void {
  const objects = frameId
    ? board.objects.filter(
        (row) => row.id === frameId || row.frameId === frameId || row.type === "connector",
      )
    : board.objects;
  const box = bounds(objects);
  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = Math.max(1, Math.round(box.w * scale));
  canvas.height = Math.max(1, Math.round(box.h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#f6f4ef";
  ctx.fillRect(0, 0, box.w, box.h);
  ctx.translate(-box.x, -box.y);
  for (const obj of objects.filter((row) => row.type === "frame")) drawObject(ctx, obj);
  for (const obj of objects.filter((row) => row.type === "connector")) {
    const from = objectCenter(board.objects, obj.fromId);
    const to = objectCenter(board.objects, obj.toId);
    if (!from || !to) continue;
    ctx.strokeStyle = "#5c6570";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  for (const obj of objects.filter((row) => row.type !== "frame" && row.type !== "connector")) {
    drawObject(ctx, obj);
  }
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug(board.title)}.png`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

function drawObject(ctx: CanvasRenderingContext2D, obj: BoardObject): void {
  if (obj.type === "frame") {
    ctx.strokeStyle = "#c4b8a5";
    ctx.lineWidth = 2;
    ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
    ctx.fillStyle = "#5c6570";
    ctx.font = "13px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(obj.text ?? "Frame", obj.x + 10, obj.y + 18);
    return;
  }
  if (obj.type === "sticky") {
    ctx.fillStyle = STICKY[obj.color ?? "amber"] ?? STICKY.amber!;
    ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
    ctx.fillStyle = "#1a1d21";
    ctx.font = "13px ui-sans-serif, system-ui, sans-serif";
    wrapText(ctx, obj.text ?? "", obj.x + 10, obj.y + 24, obj.w - 20);
    return;
  }
  if (obj.type === "card") {
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#c47b2b";
    ctx.lineWidth = 1.5;
    ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
    ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
    ctx.fillStyle = "#1a1d21";
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(obj.cite?.label || obj.text || obj.cite?.kind || "Card", obj.x + 10, obj.y + 28);
    return;
  }
  ctx.fillStyle = obj.type === "text" ? "transparent" : "#e8eef4";
  if (obj.type !== "text") ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
  ctx.fillStyle = "#1a1d21";
  ctx.font =
    obj.type === "text"
      ? "18px ui-sans-serif, system-ui, sans-serif"
      : "13px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(obj.text ?? "", obj.x + 10, obj.y + (obj.type === "text" ? 22 : 28));
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
): void {
  const words = text.split(/\s+/);
  let line = "";
  let cy = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += 16;
    } else line = next;
  }
  if (line) ctx.fillText(line, x, cy);
}

export function exportBoardPdf(board: BoardDocument): void {
  const objects = board.objects.filter((row) => row.type !== "connector");
  const body = objects
    .map((obj) => {
      const label = escapeHtml(obj.text || obj.cite?.label || obj.type);
      return `<div class="obj ${obj.type}" style="left:${obj.x}px;top:${obj.y}px;width:${obj.w}px;height:${obj.h}px">${label}</div>`;
    })
    .join("");
  printHtmlDocument(`<!DOCTYPE html><html><head><title>${escapeHtml(board.title)}</title>
<style>
body{margin:24px;font:14px ui-sans-serif,system-ui,sans-serif;color:#1a1d21;background:#f6f4ef}
h1{margin:0 0 16px}
.stage{position:relative;min-height:80vh}
.obj{position:absolute;padding:8px;border:1px solid #c4b8a5;background:#fff;overflow:hidden}
.obj.sticky{background:#f5d48a}
.obj.frame{background:transparent;border:2px solid #c4b8a5}
</style></head><body><h1>${escapeHtml(board.title)}</h1><div class="stage">${body}</div></body></html>`);
}

function slug(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "board"
  );
}
