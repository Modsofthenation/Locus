import type { DesignComment } from "@locus/shared";
import { pickSelector } from "@locus/shared";

export interface CanvasInspectPick {
  tag: string;
  id: string;
  className: string;
  text: string;
}

export function DesignInspector(props: {
  pick: CanvasInspectPick | null;
  pins: DesignComment[];
  onSelectPin: (pin: DesignComment) => void;
}) {
  const selector = props.pick ? pickSelector(props.pick) : "";
  return (
    <div className="design-inspector" role="region" aria-label="Inspector">
      <div className="design-inspector-head">Inspector</div>
      {props.pick ? (
        <dl className="design-inspector-pick">
          <div>
            <dt>Selector</dt>
            <dd>
              <code>{selector}</code>
            </dd>
          </div>
          <div>
            <dt>Tag</dt>
            <dd>{props.pick.tag}</dd>
          </div>
          {props.pick.id ? (
            <div>
              <dt>Id</dt>
              <dd>{props.pick.id}</dd>
            </div>
          ) : null}
          {props.pick.className ? (
            <div>
              <dt>Class</dt>
              <dd>{props.pick.className}</dd>
            </div>
          ) : null}
          {props.pick.text ? (
            <div>
              <dt>Text</dt>
              <dd>{props.pick.text}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="hint">Click an element on the canvas to inspect it.</p>
      )}
      {props.pins.length ? (
        <div className="design-inspector-pins">
          <div className="design-inspector-head">Pins</div>
          <ul>
            {props.pins.map((pin, index) => (
              <li key={pin.id ?? `${pin.selector}-${index}`}>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => props.onSelectPin(pin)}
                >
                  {index + 1}. {pin.selector}
                  {pin.text ? ` — ${pin.text}` : ""}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
