#!/usr/bin/env python3
"""
Transcriber - Whisper transcription script with structured output.
Communicates with the Electron main process via stdout lines:
  STATUS:<key>    - current stage: loading_model | transcribing | writing | done
  OUTPUT:<path>   - absolute path to the output file on success
  ERROR:<message> - error description (written before exit code 1)

Progress and ETA are read directly from tqdm output on stderr by the
Node.js parent process — no monkey-patching needed.
"""

import sys
import os
import argparse


def print_status(key: str):
    print(f"STATUS:{key}", flush=True)


def print_output(path: str):
    print(f"OUTPUT:{path}", flush=True)


def print_error(msg: str):
    print(f"ERROR:{msg}", flush=True)


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


def main():
    parser = argparse.ArgumentParser(description="Whisper transcription with progress")
    parser.add_argument("input_file", help="Path to audio/video file")
    parser.add_argument("--model", default="base", help="Whisper model name")
    parser.add_argument("--output_format", default="txt",
                        help="Output format: txt, srt, vtt, json, tsv, all")
    parser.add_argument("--output_dir", default=".", help="Directory for output files")
    parser.add_argument("--language", default=None,
                        help="Language code (e.g. en, fr) or omit for auto-detect")
    parser.add_argument("--device", default=None,
                        help="Device: cpu, cuda, or directml")
    args = parser.parse_args()

    # --- Import whisper ---
    try:
        import whisper
        from whisper.utils import get_writer
    except ImportError as e:
        print_error(f"Failed to import whisper: {e}")
        sys.exit(1)

    # --- Resolve device ---
    # Special handling for DirectML (AMD/Intel GPU on Windows via torch-directml)
    resolved_device = None  # will hold the final torch device
    use_directml = False

    if args.device == 'directml':
        try:
            import torch_directml
            resolved_device = torch_directml.device()
            use_directml = True
        except ImportError:
            print_error(
                "torch-directml is not installed. "
                "Run: pip install torch-directml"
            )
            sys.exit(1)
        except Exception as e:
            print_error(f"DirectML init failed: {e}")
            sys.exit(1)

    elif args.device in (None, 'auto'):
        # Smart auto-detection: CUDA → DirectML → CPU
        import torch
        if torch.cuda.is_available():
            resolved_device = 'cuda'
            print(f"STATUS_DEVICE:cuda", flush=True)
        else:
            # Try DirectML (AMD/Intel on Windows)
            try:
                import torch_directml
                resolved_device = torch_directml.device()
                use_directml = True
                print(f"STATUS_DEVICE:directml", flush=True)
            except Exception:
                resolved_device = 'cpu'
                print(f"STATUS_DEVICE:cpu", flush=True)

    else:
        resolved_device = args.device  # cuda / cpu / directml

    # --- Load model ---
    print_status("loading_model")
    if use_directml:
        try:
            model = whisper.load_model(args.model, device='cpu')
            model = densify_model(model)
            model = model.to(resolved_device)
        except Exception as dml_err:
            # torch-directml is incompatible with the current PyTorch version
            # (common when torch > 2.1.x is installed). Fall back to CPU.
            print(f"STATUS_DEVICE:cpu", flush=True)
            import sys as _sys
            print(f"[warn] DirectML load failed ({type(dml_err).__name__}): {dml_err}\n"
                  f"       Falling back to CPU.", file=_sys.stderr, flush=True)
            resolved_device = 'cpu'
            use_directml = False
            try:
                model = whisper.load_model(args.model, device='cpu')
            except Exception as e:
                print_error(str(e))
                sys.exit(1)
    else:
        try:
            model = whisper.load_model(args.model, device=resolved_device)
        except Exception as e:
            print_error(str(e))
            sys.exit(1)

    # --- Transcribe (tqdm progress goes to stderr automatically) ---
    print_status("transcribing")
    try:
        result = model.transcribe(
            args.input_file,
            language=args.language or None,
            verbose=False,   # sends tqdm progress bar to stderr
            fp16=not use_directml,  # DirectML does not support fp16
        )
    except Exception as e:
        if use_directml:
            # DirectML failed mid-transcription; retry on CPU
            print(f"STATUS_DEVICE:cpu", flush=True)
            import sys as _sys
            print(f"[warn] DirectML transcription failed ({type(e).__name__}): {e}\n"
                  f"       Falling back to CPU.", file=_sys.stderr, flush=True)
            del model
            use_directml = False
            try:
                model = whisper.load_model(args.model, device='cpu')
                result = model.transcribe(
                    args.input_file,
                    language=args.language or None,
                    verbose=False,
                    fp16=False,
                )
            except Exception as e2:
                print_error(str(e2))
                sys.exit(1)
        else:
            print_error(str(e))
            sys.exit(1)
    except Exception as e:
        print_error(str(e))
        sys.exit(1)

    # --- Write output ---
    print_status("writing")
    try:
        os.makedirs(args.output_dir, exist_ok=True)
        writer = get_writer(args.output_format, args.output_dir)
        writer(result, args.input_file)
    except Exception as e:
        print_error(f"Failed to write output: {e}")
        sys.exit(1)

    # --- Determine output path ---
    # whisper writers name files as "{input_basename}.{ext}"
    base = os.path.splitext(os.path.basename(args.input_file))[0]
    ext = "srt" if args.output_format == "all" else args.output_format
    output_path = os.path.join(args.output_dir, f"{base}.{ext}")

    print_status("done")
    print_output(output_path)


if __name__ == "__main__":
    main()
