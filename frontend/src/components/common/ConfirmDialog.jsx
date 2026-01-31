// frontend/src/components/common/ConfirmDialog.jsx
// Reusable confirmation dialog component

import React, { useEffect, useRef, useCallback } from 'react';
import './ConfirmDialog.css';

/**
 * ConfirmDialog - A styled replacement for window.confirm()
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the dialog is visible
 * @param {Function} props.onConfirm - Called when user confirms
 * @param {Function} props.onCancel - Called when user cancels
 * @param {string} props.title - Dialog title
 * @param {string} props.message - Dialog message/description
 * @param {string} props.confirmText - Text for confirm button (default: "Confirm")
 * @param {string} props.cancelText - Text for cancel button (default: "Cancel")
 * @param {string} props.variant - Button style variant: "danger" | "warning" | "default"
 */
export default function ConfirmDialog({
    isOpen,
    onConfirm,
    onCancel,
    title = 'Confirm',
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'default'
}) {
    const dialogRef = useRef(null);
    const confirmBtnRef = useRef(null);
    const cancelBtnRef = useRef(null);

    // Focus trap
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel?.();
        }
        
        if (e.key === 'Tab') {
            const focusable = [cancelBtnRef.current, confirmBtnRef.current].filter(Boolean);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
            }
        }
        
        if (e.key === 'Enter' && e.target === confirmBtnRef.current) {
            e.preventDefault();
            onConfirm?.();
        }
    }, [onCancel, onConfirm]);

    // Focus cancel button when opened (safer default)
    useEffect(() => {
        if (isOpen) {
            cancelBtnRef.current?.focus();
        }
    }, [isOpen]);

    // Prevent body scroll when open
    useEffect(() => {
        if (isOpen) {
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => {
                document.body.style.overflow = originalOverflow;
            };
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div 
            className="confirm-dialog__overlay"
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onCancel?.();
                }
            }}
            role="presentation"
        >
            <div
                ref={dialogRef}
                className="confirm-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
                aria-describedby="confirm-dialog-message"
                onKeyDown={handleKeyDown}
            >
                <h3 id="confirm-dialog-title" className="confirm-dialog__title">
                    {title}
                </h3>
                
                {message && (
                    <p id="confirm-dialog-message" className="confirm-dialog__message">
                        {message}
                    </p>
                )}
                
                <div className="confirm-dialog__actions">
                    <button
                        ref={cancelBtnRef}
                        className="confirm-dialog__btn confirm-dialog__btn--cancel"
                        onClick={onCancel}
                        type="button"
                    >
                        {cancelText}
                    </button>
                    <button
                        ref={confirmBtnRef}
                        className={`confirm-dialog__btn confirm-dialog__btn--confirm confirm-dialog__btn--${variant}`}
                        onClick={onConfirm}
                        type="button"
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Hook to manage confirm dialog state
 * 
 * Usage:
 * const { confirm, ConfirmDialogComponent } = useConfirmDialog();
 * 
 * const handleDelete = async () => {
 *     const confirmed = await confirm({
 *         title: 'Delete item?',
 *         message: 'This cannot be undone.',
 *         confirmText: 'Delete',
 *         variant: 'danger'
 *     });
 *     if (confirmed) {
 *         // proceed with delete
 *     }
 * };
 * 
 * return (
 *     <>
 *         <button onClick={handleDelete}>Delete</button>
 *         {ConfirmDialogComponent}
 *     </>
 * );
 */
export function useConfirmDialog() {
    const [dialogState, setDialogState] = React.useState({
        isOpen: false,
        title: '',
        message: '',
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        variant: 'default',
        resolve: null
    });

    const confirm = useCallback((options) => {
        return new Promise((resolve) => {
            setDialogState({
                isOpen: true,
                title: options.title || 'Confirm',
                message: options.message || '',
                confirmText: options.confirmText || 'Confirm',
                cancelText: options.cancelText || 'Cancel',
                variant: options.variant || 'default',
                resolve
            });
        });
    }, []);

    const handleConfirm = useCallback(() => {
        dialogState.resolve?.(true);
        setDialogState(prev => ({ ...prev, isOpen: false }));
    }, [dialogState.resolve]);

    const handleCancel = useCallback(() => {
        dialogState.resolve?.(false);
        setDialogState(prev => ({ ...prev, isOpen: false }));
    }, [dialogState.resolve]);

    const ConfirmDialogComponent = (
        <ConfirmDialog
            isOpen={dialogState.isOpen}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            title={dialogState.title}
            message={dialogState.message}
            confirmText={dialogState.confirmText}
            cancelText={dialogState.cancelText}
            variant={dialogState.variant}
        />
    );

    return { confirm, ConfirmDialogComponent };
}
