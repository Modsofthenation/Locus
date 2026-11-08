import {
  addBoardTimelineItem,
  boardDayUtc,
  boardTimelineSpan,
  shiftBoardTimelineItem,
  type BoardObject,
  type BoardTimeline,
  type BoardTimelineItem,
  type BoardTimelineScale,
} from "@locus/shared";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Select } from "@/components/layout/Select";

function monthLabel(day: string): string {
  const t = boardDayUtc(day);
  return new Date(t).toLocaleString("en", { month: "long", timeZone: "UTC" });
}

function dayLabel(day: string): string {
  return String(new Date(boardDayUtc(day)).getUTCDate());
}

function rangeDays(start: string, end: string): number {
  return Math.max(1, Math.round((boardDayUtc(end) - boardDayUtc(start)) / 86_400_000) + 1);
}

function columnsFor(scale: BoardTimelineScale, start: string, end: string): string[] {
  const days: string[] = [];
  const last = boardDayUtc(end);
  let t = boardDayUtc(start);
  const step = scale === "months" ? 30 : scale === "weeks" ? 7 : 1;
  while (t <= last) {
    days.push(new Date(t).toISOString().slice(0, 10));
    t += step * 86_400_000;
  }
  return days.length ? days : [start];
}

export function BoardTimelineObject(props: {
  obj: BoardObject;
  onChange: (next: BoardObject) => void;
  onSelect: () => void;
}) {
  const timeline = props.obj.timeline;
  const chart = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (!timeline) return <span className="board-obj-text">{props.obj.text || "Timeline view"}</span>;
  const data = timeline;

  const span = boardTimelineSpan(data.items);
  const cols = columnsFor(data.scale, span.start, span.end);
  const total = rangeDays(span.start, span.end);
  const today = new Date().toISOString().slice(0, 10);
  const todayOff =
    today >= span.start && today <= span.end
      ? ((boardDayUtc(today) - boardDayUtc(span.start)) / 86_400_000 / total) * 100
      : undefined;

  function patch(next: BoardTimeline) {
    props.onChange({ ...props.obj, timeline: next });
  }

  function barStyle(item: BoardTimelineItem): { left: string; width: string } {
    const start = Math.max(0, (boardDayUtc(item.start) - boardDayUtc(span.start)) / 86_400_000);
    const dur = rangeDays(item.start, item.end);
    return {
      left: `${(start / total) * 100}%`,
      width: `${Math.max(4, (dur / total) * 100)}%`,
    };
  }

  function startDrag(event: ReactPointerEvent, item: BoardTimelineItem) {
    event.preventDefault();
    event.stopPropagation();
    props.onSelect();
    const origin = event.clientX;
    const width = chart.current?.getBoundingClientRect().width || 1;
    const move = (ev: PointerEvent) => {
      const days = Math.round(((ev.clientX - origin) / width) * total);
      patch({
        ...data,
        items: data.items.map((row) =>
          row.id === item.id ? shiftBoardTimelineItem(item, days) : row,
        ),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="board-timeline">
      <div className="board-widget-tab">
        <span className="board-widget-kind" aria-hidden>
          ▤
        </span>
        {title !== null ? (
          <input
            className="board-widget-ui"
            value={title}
            autoFocus
            aria-label="Timeline title"
            onChange={(event) => setTitle(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={() => {
              props.onChange({ ...props.obj, text: title.trim() || "Timeline view" });
              setTitle(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="board-widget-ui board-widget-title"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              props.onSelect();
              setTitle(props.obj.text || "Timeline view");
            }}
          >
            {props.obj.text || "Timeline view"}
          </button>
        )}
        <label
          className="board-widget-ui board-timeline-scale"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Select
            compact
            ariaLabel="Timeline scale"
            value={data.scale}
            options={[
              { value: "days", label: "Days" },
              { value: "weeks", label: "Weeks" },
              { value: "months", label: "Months" },
            ]}
            onChange={(value) => patch({ ...timeline, scale: value as BoardTimelineScale })}
          />
        </label>
      </div>
      <div className="board-timeline-body">
        <aside
          className="board-timeline-list board-widget-ui"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <p>{timeline.items.length} records</p>
          {timeline.items.map((item) =>
            editId === item.id ? (
              <input
                key={item.id}
                value={draft}
                autoFocus
                aria-label="Task title"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                  patch({
                    ...timeline,
                    items: timeline.items.map((row) =>
                      row.id === item.id ? { ...row, title: draft.trim() || row.title } : row,
                    ),
                  });
                  setEditId(null);
                }}
              />
            ) : (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  props.onSelect();
                  setEditId(item.id);
                  setDraft(item.title);
                }}
              >
                {item.title}
              </button>
            ),
          )}
          <button
            type="button"
            className="board-table-add-row"
            aria-label="Add task"
            onClick={() => {
              props.onSelect();
              patch(addBoardTimelineItem(timeline));
            }}
          >
            +
          </button>
        </aside>
        <div
          ref={chart}
          className="board-timeline-chart board-widget-ui"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="board-timeline-head">
            {cols.map((day) => (
              <div key={day} className="board-timeline-col">
                {timeline.scale === "days" ? dayLabel(day) : monthLabel(day)}
                {timeline.scale !== "months" ? (
                  <span>{timeline.scale === "weeks" ? dayLabel(day) : ""}</span>
                ) : null}
              </div>
            ))}
          </div>
          {typeof todayOff === "number" ? (
            <div className="board-timeline-today" style={{ left: `${todayOff}%` }}>
              <span>Today</span>
            </div>
          ) : null}
          <div className="board-timeline-lanes">
            {timeline.items.map((item) => (
              <div key={item.id} className="board-timeline-lane">
                <button
                  type="button"
                  className={`board-timeline-bar color-${item.color ?? "amber"}`}
                  style={barStyle(item)}
                  aria-label={`${item.title} ${item.start} to ${item.end}`}
                  onPointerDown={(event) => startDrag(event, item)}
                >
                  {item.title}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
