//! The global allocator: the system one, except that a failed allocation aborts at once (ENC-A5).
//! std's default handler first writes "memory allocation of N bytes failed" to stderr, which breaks
//! invariant 2 and tells the host N (the blob size shows in it). The only unsafe code in the crate.
#![allow(unsafe_code)]

use std::alloc::{GlobalAlloc, Layout, System};

pub struct AbortOnNull;

fn or_abort(p: *mut u8) -> *mut u8 {
    if p.is_null() {
        std::process::abort();
    }
    p
}

// SAFETY: every call goes straight to `System` with the caller's arguments; only a null result
// is replaced by an abort, which never returns.
unsafe impl GlobalAlloc for AbortOnNull {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        or_abort(unsafe { System.alloc(layout) })
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        or_abort(unsafe { System.alloc_zeroed(layout) })
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        or_abort(unsafe { System.realloc(ptr, layout, new_size) })
    }
}
