# Plan: Fix DirectML SparsePrivateUse1 error via densify patch

## Problem
`model.to(dml_device)` raises `NotImplementedError: Could not run 'aten::_sparse_coo_tensor_with_dims_and_tensors' with arguments from the 'SparsePrivateUse1' backend` even with the correct torch==2.4.1 + torch-directml 0.2.5 version pair.

Root cause: the Whisper model checkpoint contains at least one sparse tensor (parameter or buffer). When moved to the DirectML device, PyTorch dispatches sparse ops to the `SparsePrivateUse1` backend, which torch-directml has registered but not implemented.

## Change (single file: transcribe.py)

Add a `densify_model()` helper just before `main()`:

```python
def densify_model(model):
    """
    Convert any sparse parameters/buffers to dense before moving to DirectML.
    torch-directml does not implement sparse ops (SparsePrivateUse1 backend),
    so any sparse tensors in the model checkpoint must be densified first.
    """
    import torch
    for module in model.modules():
        for name, buf in list(module._buffers.items()):
            if buf is not None and buf.is_sparse:
                module._buffers[name] = buf.to_dense()
        for name, param in list(module._parameters.items()):
            if param is not None and param.is_sparse:
                module._parameters[name] = torch.nn.Parameter(
                    param.data.to_dense(),
                    requires_grad=param.requires_grad,
                )
    return model
```

In the DirectML load block (line ~94), call it before `.to()`:

```python
    if use_directml:
        try:
            model = whisper.load_model(args.model, device='cpu')
            model = densify_model(model)          # <-- new line
            model = model.to(resolved_device)
```

## Risk

If the sparse tensor is **not** stored in the checkpoint but is created **dynamically during `.to()`** by PyTorch's internal dispatch machinery, densifying stored tensors won't prevent it. In that case the fallback to CPU still applies and Option B (faster-whisper) becomes the right path.

## Build step

Only `transcribe.py` changes — no npm/pip changes. Rebuild with `pnpm build:win64`.
