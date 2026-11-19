import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../../core/api/client';

export function ProtectedImage({ src, alt = '', className, fallback = null, lazy = false }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(
    () => !lazy || typeof IntersectionObserver === 'undefined'
  );
  const holderRef = useRef(null);

  // La foto del estudiante se guarda como data-URL base64 en `foto_url`.
  // Concatenar API_BASE + "data:image/..." produce una URL invalida y la foto
  // nunca se mostraba. Tampoco tiene sentido pedirle token a una URL absoluta.
  const esDirecto = typeof src === 'string'
    && (src.startsWith('data:') || /^https?:\/\//i.test(src));

  useEffect(() => {
    if (!lazy || visible) return;
    const node = holderRef.current;
    if (!node) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [lazy, visible]);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setObjectUrl(null);

    if (!src || !visible) return;
    if (esDirecto) return; // data: o http(s):// -> se usa tal cual

    fetch(`${API_BASE}${src}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('No disponible');
        return res.blob();
      })
      .then(blob => {
        if (cancelled) return;
        setObjectUrl(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [src, visible, esDirecto]);

  useEffect(() => {
    return () => {
      if (objectUrl && objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const listo = src && !failed && (esDirecto || objectUrl);
  const content = listo
    ? <img
        src={esDirecto ? src : objectUrl}
        alt={alt}
        className={lazy ? 'w-full h-full object-cover' : className}
      />
    : fallback;

  if (!lazy) return content;

  return (
    <span ref={holderRef} className={`block ${className}`}>
      {content}
    </span>
  );
}
