import { renderSVG } from "uqr";
import { useMemo } from "react";

export function PairingQr({ url, label = "Pairing QR code" }: { url: string; label?: string }) {
  const svg = useMemo(
    () =>
      renderSVG(url, {
        border: 2,
        pixelSize: 8,
        whiteColor: "#ffffff",
        blackColor: "#0b0d10",
      }),
    [url],
  );
  return (
    <div className="phone-qr" data-testid="phone-qr" data-pairing-url={url}>
      <div
        className="phone-qr-code"
        role="img"
        aria-label={label}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
