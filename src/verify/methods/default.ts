// Default (address-to-address) asset transfer method.
//
// This is the historical cardano402 path; verification is the existing
// 11-check pipeline run by `verifyPayment`. This module exists primarily to
// give the route handler a single import for method-specific entry points
// once additional methods land alongside.

export { verifyPayment as verifyDefault } from '../verify-payment.js';
