import { useRef } from "react";
import { PairingQr } from "@/components/settings/PairingQr";
import { useDialogFocus } from "@/lib/useDialogFocus";

export function GamePlayLinkPanel(props: {
  url: string;
  lanUrls: string[];
  copied: boolean;
  onClose: () => void;
}) {
  const qrUrl = props.lanUrls[0] || props.url;
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, props.onClose, dialogRef);
  return (
    <div
      className="game-play-link"
      role="dialog"
      aria-modal="true"
      aria-label="Play link"
      ref={dialogRef}
    >
      <header className="game-play-link-head">
        <p className="game-play-link-badge">Unlisted</p>
        <button
          type="button"
          className="btn small ghost"
          onClick={props.onClose}
          aria-label="Close play link"
        >
          Close
        </button>
      </header>
      <p className="game-play-link-copy">
        Anyone with this link can play. It is not listed anywhere else.
      </p>
      <PairingQr url={qrUrl} label="Play-on-phone QR code" />
      <ul className="phone-urls">
        <li>{props.url}</li>
        {props.lanUrls.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
      <p className="game-play-link-copied">{props.copied ? "Copied" : "Link on clipboard"}</p>
    </div>
  );
}
