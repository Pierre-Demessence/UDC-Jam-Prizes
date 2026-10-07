import { useEffect, useId, useRef } from 'react';

import { CloseIcon } from '@/gallery/icons';

interface CategoryDialogProps {
  children: React.ReactNode;
  onClose: () => void;
}

/**
 * The category tree on a narrow screen: a full-screen native `<dialog>`, which
 * gives focus trapping and Escape for free. React owns whether it is mounted, so
 * Escape asks the parent to unmount it instead of closing the element itself.
 */
export function CategoryDialog({ children, onClose }: CategoryDialogProps) {
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
      className="category-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <div className="category-dialog-header">
        <h2 id={titleId}>Categories</h2>
        <button aria-label="Close the category list" className="icon-button" onClick={onClose} type="button">
          <CloseIcon size={20} />
        </button>
      </div>
      <div className="category-dialog-body">{children}</div>
    </dialog>
  );
}
