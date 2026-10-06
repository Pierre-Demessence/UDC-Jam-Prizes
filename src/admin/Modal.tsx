import { useEffect, useId, useRef } from 'react';

interface ModalProps {
  children: React.ReactNode;
  /** The heading, which is also the dialog's accessible name. */
  title: string;
  /** Called on Escape or the close button. A click outside does nothing. */
  onClose: () => void;
}

/**
 * A form in a native `<dialog>`: it sits in the browser's top layer, `showModal`
 * traps the focus and Escape closes it — all of which a hand-rolled overlay has
 * to rebuild. React still owns whether it is mounted, so every close path calls
 * `onClose` rather than letting the browser close the element on its own.
 */
export function Modal({ children, onClose, title }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialogRef.current;
    if (element !== null && !element.open)
      element.showModal();
  }, []);

  return (
    <dialog
      aria-labelledby={titleId}
      className="modal"
      onCancel={(event) => {
        // Escape would close the dialog behind React's back: let the parent unmount it instead.
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <div className="modal-header">
        <h2 className="modal-title" id={titleId}>{title}</h2>
        <button aria-label="Close the form" className="modal-close" onClick={onClose} type="button">✕</button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
