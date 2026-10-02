'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScanBarcode, Flashlight, CheckCircle2, SearchX } from 'lucide-react';
import { createScanGate } from '@/lib/pos-core.mjs';
import { loadBarcodeDecoder } from '@/lib/barcode-loader.mjs';
import { captureScanFrame, decodeScanFrame, scanFrame } from '@/lib/camera-scan.mjs';
export default function Camera({
  onScan,
  onClose,
  feedback,
}: {
  onScan: (code: string) => void;
  onClose: () => void;
  feedback: { ok: boolean; text: string; code: string; at: number } | null;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState('正在開啟相機…');
  const [torch, setTorch] = useState(false);
  const track = useRef<MediaStreamTrack | null>(null);
  const scan = useRef(onScan);
  const [flash, setFlash] = useState(false);
  const [added, setAdded] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [zoomRange, setZoomRange] = useState<{min: number; max: number; step: number} | null>(null);
  const [zoom, setZoom] = useState(1);
  scan.current = onScan;
  useEffect(() => {
    if (!feedback) return;
    setMessage(feedback.text);
    setFlash(true);
    if (feedback.ok) setAdded((n) => n + 1);
    navigator.vibrate?.(feedback.ok ? 40 : [60, 40, 60]);
    const timer = setTimeout(() => setFlash(false), 1000);
    return () => clearTimeout(timer);
  }, [feedback]);
  useEffect(() => {
    setFailed(false);
    setTorch(false);
    setMessage('正在開啟相機…');
    let stopped = false,
      stream: MediaStream | undefined;
    const scanGate = createScanGate();
    let timer: ReturnType<typeof setTimeout>;
    const accept = (code: string) => {
      if (stopped || !scanGate(code)) return;
      scan.current(code);
      setMessage('正在比對 ' + code);
    };
    (async () => {
      try {
        // Warm the fallback while the browser opens the camera. A load failure
        // must not prevent native scanning on devices that support it.
        let reader: any = null;
        let thoroughReader: any = null;
        let fallbackError: any;
        const fallback = loadBarcodeDecoder().then(({ BrowserMultiFormatReader, DecodeHintType, BarcodeFormat }: any) => {
          const hints = new Map();
          hints.set(DecodeHintType.TRY_HARDER, true);
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF]);
          reader = new BrowserMultiFormatReader(hints);
          thoroughReader = reader;
          reader = new BrowserMultiFormatReader(new Map(hints).set(DecodeHintType.TRY_HARDER, false));
        }).catch((e: any) => { fallbackError = e; });
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        track.current = stream.getVideoTracks()[0];
        const capabilities = track.current.getCapabilities?.() as any;
        setZoomRange(capabilities?.zoom || null);
        setZoom((track.current.getSettings() as any).zoom || 1);
        try {
          await track.current.applyConstraints({
            advanced: [{ focusMode: 'continuous', exposureMode: 'continuous', whiteBalanceMode: 'continuous' } as any],
          });
        } catch {}
        const el = video.current!;
        el.srcObject = stream;
        await el.play();
        if (stopped) return;
        setMessage('將條碼放進畫面，辨識後移開再掃下一件');
        const Native = (window as any).BarcodeDetector;
        const formats = [
          'ean_13',
          'ean_8',
          'code_128',
          'code_39',
          'upc_a',
          'upc_e',
          'itf',
        ];
        let detector: any = null;
        if (Native) {
          try {
            const supported = await Native.getSupportedFormats();
            const usable = formats.filter(f => supported.includes(f));
            if (usable.length) detector = new Native({ formats: usable });
          } catch {}
        }
        if (!detector) {
          await fallback;
          if (!reader) throw fallbackError;
        }
        if (stopped) return;
        const canvas = document.createElement('canvas');
        let pass = 0;
        const tick = async () => {
          if (stopped) return;
          const start = performance.now();
          if (el.readyState >= 2 && el.videoWidth && el.videoHeight) {
            let code: string | null = null;
            if (detector) {
              captureScanFrame(canvas, el, el.videoWidth, el.videoHeight, 5);
              code = await decodeScanFrame(canvas, detector, null);
            }
            for (let i = 0; !code && reader && i < 2; i++) {
              const current = pass++;
              captureScanFrame(canvas, el, el.videoWidth, el.videoHeight, current);
              const detailed = scanFrame(el.videoWidth, el.videoHeight, current).tryHarder;
              code = await decodeScanFrame(canvas, null, detailed ? thoroughReader : reader);
              if (detailed || performance.now() - start >= 35) break;
            }
            if (code) accept(code);
          }
          if (!stopped) timer = setTimeout(tick, Math.max(20, 55 - (performance.now() - start)));
        };
        void tick();
      } catch (e: any) {
        stream?.getTracks().forEach((t) => t.stop());
        track.current = null;
        if (stopped) return;
        setFailed(true);
        setMessage(
          e.name === 'NotAllowedError'
            ? '相機權限尚未允許。請在瀏覽器開啟相機權限後重試。'
            : '相機無法啟動：' + e.message,
        );
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      track.current = null;
    };
  }, [attempt]);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="camera-dialog">
        <DialogTitle>
          <ScanBarcode /> 連續掃描
        </DialogTitle>
        <DialogDescription>整個畫面都能辨識，無須對準細線。</DialogDescription>
        <div
          className="camera-viewport"
          data-result={flash ? (feedback?.ok ? 'success' : 'error') : ''}
        >
          <video ref={video} playsInline muted className="camera-video" />
          {flash && feedback && (
            <div key={feedback.at} className="camera-feedback">
              {feedback.ok ? <CheckCircle2 /> : <SearchX />}
              <b>
                {feedback.ok
                  ? '已加入商品'
                  : feedback.text.startsWith('查無商品')
                    ? '查無商品'
                    : '暫時無法加入'}
              </b>
              <span>{feedback.code}</span>
            </div>
          )}
          <span className="camera-count">已加入 {added} 次</span>
        </div>
        <p className="camera-status" role="status">
          {message}
        </p>
        <p className="camera-tip">條碼模糊時，先稍微拉遠，讓鏡頭對焦。</p>
        {zoomRange && zoomRange.max > zoomRange.min && (
          <label className="camera-zoom">鏡頭放大 {zoom.toFixed(1)}×
            <input aria-label="鏡頭放大" type="range" min={zoomRange.min} max={Math.min(zoomRange.max, 3)} step={zoomRange.step || 0.1} value={zoom}
              onChange={async e => {
                const value = Number(e.target.value);
                try {
                  await track.current?.applyConstraints({advanced:[{zoom:value} as any]});
                  setZoom(value);
                } catch { setMessage('此相機無法調整放大倍率'); }
              }} />
          </label>
        )}
        {failed && (
          <Button onClick={() => setAttempt((n) => n + 1)}>重試啟動相機</Button>
        )}
        <Button
          variant="outline"
          disabled={failed}
          onClick={async () => {
            try {
              await track.current?.applyConstraints({
                advanced: [{ torch: !torch } as any],
              });
              setTorch(!torch);
            } catch {
              setMessage('此相機不支援補光燈');
            }
          }}
        >
          <Flashlight /> {torch ? '關閉補光' : '開啟補光'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
