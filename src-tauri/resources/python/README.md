# TesRig packaged Python runtime

TesRig bundles the official CPython 3.12.10 Windows embeddable distribution at:

`windows/python-3.12.10-embed-amd64.zip`

Source: `https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip`

SHA-256: `4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3`

The archive is extracted into the app-local data directory on first use. The archive's own
`LICENSE.txt` is retained. `TESRIG_PYTHON` may point development builds at a different interpreter.

Linux and macOS packages should place their self-contained runtime at
`linux/bin/python3` and `macos/bin/python3` respectively; the runtime resolver already supports
those layouts.
