import {
  addBoardTableColumn,
  addBoardTableRow,
  setBoardTableCell,
  type BoardObject,
  type BoardTable,
  type BoardTableColumnKind,
} from "@locus/shared";
import { useState } from "react";

const KIND_MARK: Record<BoardTableColumnKind, string> = {
  text: "≡",
  status: "✓",
  person: "☺",
  date: "▦",
  number: "#",
  select: "▾",
};

export function BoardTableObject(props: {
  obj: BoardObject;
  onChange: (next: BoardObject) => void;
  onSelect: () => void;
}) {
  const table = props.obj.table;
  const [title, setTitle] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ rowId: string; columnId: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [header, setHeader] = useState<string | null>(null);

  if (!table) return <span className="board-obj-text">{props.obj.text || "Table view"}</span>;

  function patch(next: BoardTable) {
    props.onChange({ ...props.obj, table: next });
  }

  return (
    <div className="board-table">
      <div className="board-widget-tab">
        <span className="board-widget-kind" aria-hidden>
          ▦
        </span>
        {title !== null ? (
          <input
            className="board-widget-ui"
            value={title}
            autoFocus
            aria-label="Table title"
            onChange={(event) => setTitle(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={() => {
              props.onChange({ ...props.obj, text: title.trim() || "Table view" });
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
              setTitle(props.obj.text || "Table view");
            }}
          >
            {props.obj.text || "Table view"}
          </button>
        )}
      </div>
      <div
        className="board-table-scroll board-widget-ui"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <table>
          <thead>
            <tr>
              <th className="board-table-index">#</th>
              {table.columns.map((col, i) => (
                <th key={col.id}>
                  <span className="board-table-kind" title={col.kind}>
                    {KIND_MARK[col.kind]}
                  </span>
                  {header === col.id ? (
                    <input
                      value={draft}
                      autoFocus
                      aria-label={`Column ${i + 1} name`}
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={() => {
                        patch({
                          ...table,
                          columns: table.columns.map((row) =>
                            row.id === col.id ? { ...row, name: draft.trim() || row.name } : row,
                          ),
                        });
                        setHeader(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        props.onSelect();
                        setHeader(col.id);
                        setDraft(col.name);
                      }}
                    >
                      {col.name}
                    </button>
                  )}
                </th>
              ))}
              <th className="board-table-add">
                <button
                  type="button"
                  aria-label="Add column"
                  onClick={() => {
                    props.onSelect();
                    patch(addBoardTableColumn(table));
                  }}
                >
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={row.id}>
                <td className="board-table-index">{i + 1}</td>
                {table.columns.map((col) => {
                  const editing = edit?.rowId === row.id && edit.columnId === col.id;
                  return (
                    <td key={col.id}>
                      {editing ? (
                        <input
                          value={draft}
                          autoFocus
                          aria-label={`${col.name} row ${i + 1}`}
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={() => {
                            patch(setBoardTableCell(table, row.id, col.id, draft));
                            setEdit(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="board-table-cell"
                          onClick={() => {
                            props.onSelect();
                            setEdit({ rowId: row.id, columnId: col.id });
                            setDraft(row.cells[col.id] ?? "");
                          }}
                        >
                          {row.cells[col.id] || ""}
                        </button>
                      )}
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="board-table-add-row"
          aria-label="Add row"
          onClick={() => {
            props.onSelect();
            patch(addBoardTableRow(table));
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
