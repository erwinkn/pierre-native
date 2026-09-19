// Test GPUI's real fallback path by simulating an unavailable WebGPU adapter.
// WebGL2, shader compilation, drawing, and input all use the actual browser.
if (navigator.gpu) navigator.gpu.requestAdapter = async () => null;
