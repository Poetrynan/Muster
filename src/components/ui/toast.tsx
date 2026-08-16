import { useEffect, useState } from "react";

/**
 * 全局 Toast（项目统一样式）：底部居中、深色圆角、3s 自动消失。
 * 挂载 <ToastHost /> 到 App 根后，任何页面/组件都能直接 showToast()。
 */
type ToastMsg = { text: string; id: number } | null;
let current: ToastMsg = null;
const listeners = new Set<(t: ToastMsg) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string) {
  if (timer) clearTimeout(timer);
  current = { text: message, id: Date.now() };
  listeners.forEach((l) => l(current));
  timer = setTimeout(() => {
    current = null;
    listeners.forEach((l) => l(null));
  }, 3000);
}

export function ToastHost() {
  const [toast, setToast] = useState<ToastMsg>(current);
  useEffect(() => {
    listeners.add(setToast);
    setToast(current);
    return () => {
      listeners.delete(setToast);
    };
  }, []);
  if (!toast) return null;
  return (
    <div
      key={toast.id}
      role="status"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-foreground text-background text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2"
    >
      {toast.text}
    </div>
  );
}
