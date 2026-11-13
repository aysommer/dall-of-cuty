// Соединение с сервером в фоновом потоке (Web Worker). Основной поток занят отрисовкой: пока рисуется кадр,
// пришедшие сообщения ждут. Из фонового потока замер задержки («lat») получает ответ сразу — пинг показывает сеть,
// а не то, насколько тяжёлая у игрока графика. Остальные сообщения передаются в основной поток как есть.
// Если фоновые потоки недоступны — обычный WebSocket в основном потоке.

/** Код фонового потока: без внешних ссылок — превращается в текст */
function workerMain(): void {
  const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown) => void };
  let ws: WebSocket | null = null;
  ctx.onmessage = (e: MessageEvent): void => {
    const d = e.data as { open?: string; send?: string };
    if (d.open) {
      ws = new WebSocket(d.open);
      ws.onopen = () => ctx.postMessage({ ev: 'open' });
      ws.onclose = () => ctx.postMessage({ ev: 'close' });
      ws.onmessage = (m: MessageEvent<string>) => {
        // Замер задержки: метку времени — сразу обратно, не дожидаясь основного потока
        if (m.data.startsWith('{"t":"lat"')) {
          const at = /"at":(\d+)/.exec(m.data)?.[1];
          if (at) ws!.send(`{"t":"pong","at":${at}}`);
        }
        ctx.postMessage({ ev: 'message', data: m.data });
      };
    } else if (d.send !== undefined && ws && ws.readyState === WebSocket.OPEN) ws.send(d.send);
  };
}

type Handler = (data?: string) => void;

export interface GameSocket {
  /** Ответ на замер задержки отправлен фоновым потоком — основному отвечать не нужно */
  readonly pongInWorker: boolean;
  isOpen(): boolean;
  send(text: string): void;
  on(ev: 'open' | 'close' | 'message', f: Handler): void;
}

export function openSocket(url: string): GameSocket {
  const handlers: Record<string, Handler[]> = { open: [], close: [], message: [] };
  const emit = (ev: string, data?: string): void => { for (const f of handlers[ev]!) f(data); };
  let open = false;
  try {
    const src = URL.createObjectURL(new Blob([`(${workerMain.toString()})()`], { type: 'text/javascript' }));
    const w = new Worker(src);
    w.onmessage = (e: MessageEvent): void => {
      const d = e.data as { ev: string; data?: string };
      if (d.ev === 'open') open = true;
      if (d.ev === 'close') open = false;
      emit(d.ev, d.data);
    };
    w.postMessage({ open: url });
    return {
      pongInWorker: true,
      isOpen: () => open,
      send: (text) => w.postMessage({ send: text }),
      on: (ev, f) => { handlers[ev]!.push(f); },
    };
  } catch {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => emit('open'));
    ws.addEventListener('close', () => emit('close'));
    ws.addEventListener('message', (e: MessageEvent<string>) => emit('message', e.data));
    return {
      pongInWorker: false,
      isOpen: () => ws.readyState === WebSocket.OPEN,
      send: (text) => ws.send(text),
      on: (ev, f) => { handlers[ev]!.push(f); },
    };
  }
}
