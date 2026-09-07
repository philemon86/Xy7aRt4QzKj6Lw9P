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
    let stopped = false,
      controls: any,
      stream: MediaStream;
    const scanGate = createScanGate();
    let timer: ReturnType<typeof setTimeout>;
    const accept = (code: string) => {
      if (!scanGate(code)) return;
      scan.current(code);
      setMessage('正在比對 ' + code);
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        track.current = stream.getVideoTracks()[0];
        try {
          await track.current.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as any],
          });
        } catch {}
        const el = video.current!;
        el.srcObject = stream;
        await el.play();
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
        if (Native && (await Native.getSupportedFormats()).includes('ean_13')) {
          const supported = await Native.getSupportedFormats();
          const detector = new Native({
            formats: formats.filter((f) => supported.includes(f)),
          });
          const tick = async () => {
            if (stopped) return;
            try {
              const results = await detector.detect(el);
              if (results[0]) accept(results[0].rawValue);
            } catch {}
            timer = setTimeout(tick, 90);
          };
          tick();
        } else {
          const [
            { BrowserMultiFormatReader },
            { DecodeHintType, BarcodeFormat },
          ] = await Promise.all([
            import('@zxing/browser'),
            import('@zxing/library'),
          ]);
          if (stopped) return;
          const hints = new Map();
          hints.set(DecodeHintType.TRY_HARDER, true);
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
            BarcodeFormat.ITF,
          ]);
          const reader = new BrowserMultiFormatReader(hints, {
            delayBetweenScanAttempts: 80,
            delayBetweenScanSuccess: 120,
          });
          controls = await reader.decodeFromVideoElement(el, (result) => {
            if (result) accept(result.getText());
          });
          if (stopped) controls.stop();
        }
      } catch (e: any) {
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
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
      track.current = null;
    };
  }, []);
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
        <Button
          variant="outline"
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
