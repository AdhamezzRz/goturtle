import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

/** CODE128 barcode for AWB labels and hub scanning. */
export function Barcode({ value, height = 48, width = 1.6, fontSize = 13, displayValue = true }: { value: string; height?: number; width?: number; fontSize?: number; displayValue?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, value, { format: 'CODE128', height, width, fontSize, displayValue, margin: 0, font: 'Inter' });
  }, [value, height, width, fontSize, displayValue]);
  return <svg ref={ref} />;
}

export function QrCode({ value, size = 96 }: { value: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 0, width: size * 2, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => setSrc(''));
  }, [value, size]);
  return src ? <img src={src} width={size} height={size} alt="QR" /> : <span style={{ width: size, height: size, display: 'inline-block' }} />;
}
