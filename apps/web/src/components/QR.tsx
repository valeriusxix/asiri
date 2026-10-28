import { QRCodeSVG } from "qrcode.react";

/** QR code as inline SVG (no images to download; CSP-friendly). */
export function QR({ value, size = 232, title }: { value: string; size?: number; title: string }) {
  return (
    <div className="inline-block rounded-2xl bg-surface p-3 ring-1 ring-border">
      <QRCodeSVG value={value} size={size} level="M" marginSize={0} title={title} className="block h-auto max-w-full" />
    </div>
  );
}
