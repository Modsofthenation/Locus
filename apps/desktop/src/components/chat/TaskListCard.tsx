import { useState } from "react";
import { previewTaskItems, taskListDoneCount, type TaskItem } from "@locus/shared";
import {
  IconTaskBurst,
  IconTaskCancelled,
  IconTaskDone,
  IconTaskList,
  IconTaskToggle,
} from "@/components/layout/Icons";

function TaskIcon({ status }: { status: TaskItem["status"] }) {
  if (status === "done") return <IconTaskDone />;
  if (status === "cancelled") return <IconTaskCancelled />;
  return <IconTaskBurst />;
}

function statusLabel(status: TaskItem["status"]): string {
  return status === "in_progress" ? "in progress" : status;
}

export function TaskListCard({ tasks }: { tasks: TaskItem[] }) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  if (!tasks.length) return null;
  const done = taskListDoneCount(tasks);
  const preview = previewTaskItems(tasks, false);
  const canViewAll = preview.length < tasks.length;
  const visible = showAll ? tasks : preview;
  const heading = `${done} of ${tasks.length} Done`;

  return (
    <div
      className={`task-list${open ? "" : " collapsed"}`}
      data-testid="task-list"
      role="region"
      aria-label={`Task list, ${heading}`}
    >
      <div className="task-list-head">
        <span className="task-list-progress">
          <IconTaskList />
          {heading}
        </span>
        {canViewAll ? (
          <button
            type="button"
            className="task-list-view-all"
            data-testid="task-list-view-all"
            aria-expanded={showAll}
            onClick={() => {
              setOpen(true);
              setShowAll((value) => !value);
            }}
          >
            {showAll ? "Show less" : "View All"}
          </button>
        ) : null}
        <button
          type="button"
          className="task-list-toggle"
          data-testid="task-list-toggle"
          aria-expanded={open}
          aria-label={open ? "Collapse task list" : "Expand task list"}
          onClick={() => setOpen((value) => !value)}
        >
          <IconTaskToggle />
        </button>
      </div>
      {open ? (
        <ul className={showAll && visible.length > preview.length ? "task-list-all" : undefined}>
          {visible.map((item) => (
            <li
              key={item.id}
              data-status={item.status}
              data-testid={`task-item-${item.id}`}
              aria-label={`${statusLabel(item.status)}: ${item.text}`}
              aria-current={item.status === "in_progress" ? "true" : undefined}
            >
              <span className="task-list-icon">
                <TaskIcon status={item.status} />
              </span>
              <span className="task-list-text">{item.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
