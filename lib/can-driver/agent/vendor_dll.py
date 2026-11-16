"""Shared vendor-DLL lookup for CAN adapters.

Vendor DLLs are never shipped with the npm package.  Each adapter keeps its
optional ``dll/`` directory next to its Python module and calls this helper:

    lib = load_vendor_dll(
        "zlg", __file__, {"win32": "zlgcan.dll", "linux": "libusbcanfd.so"},
        legacy_attr="_zlg_dll_dir", loader=ctypes.cdll,
    )

Search order:
  1. ``EWB_<ID>_DLL_DIR`` environment variable (directory or direct file)
  2. legacy ``sys._<id>_dll_dir`` attribute (tests / embedding)
  3. ``<exe_dir>/dll/<id>/`` when frozen
  4. ``<adapter module>/dll/`` (default location in the npm package)

The default directory is created before raising so the error message always
points at a path the user can copy into.
"""

import os
import sys
from ctypes import CDLL


def _platform_name():
    if sys.platform == 'win32':
        return 'win32'
    if sys.platform.startswith('linux'):
        return 'linux'
    return sys.platform


def load_vendor_dll(vendor_id, module_file, names, *, env_var=None,
                    legacy_attr=None, loader=None, hint=None):
    """Load a vendor DLL/SO or raise a path-rich ``FileNotFoundError``.

    Args:
        vendor_id: registry id, e.g. ``"zlg"`` or ``"cxcan"``.
        module_file: adapter module path; its sibling ``dll/`` is the default.
        names: mapping like ``{"win32": "zlgcan.dll", "linux": "libusbcanfd.so"}``.
        env_var: override environment variable; defaults to ``EWB_<ID>_DLL_DIR``.
        legacy_attr: optional ``sys`` attribute, e.g. ``"_zlg_dll_dir"``.
        loader: ``ctypes.cdll`` (cdecl, default) or ``ctypes.windll`` (stdcall).
        hint: optional extra line for the not-found error.
    """
    platform = _platform_name()
    name = names.get(platform)
    if not name:
        raise OSError(f"{vendor_id} CAN driver unsupported on platform {sys.platform!r}.")

    env_var = env_var or f"EWB_{vendor_id.upper()}_DLL_DIR"
    adapter_dir = os.path.dirname(os.path.abspath(module_file))
    primary = os.path.join(adapter_dir, 'dll', name)
    candidates = []

    custom = os.environ.get(env_var) or (getattr(sys, legacy_attr, None) if legacy_attr else None)
    if custom:
        custom = os.path.expanduser(str(custom))
        candidates.append(custom if custom.lower().endswith(name.lower())
                          else os.path.join(custom, name))

    if getattr(sys, 'frozen', False):
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        candidates.append(os.path.join(exe_dir, 'dll', vendor_id, name))

    candidates.append(primary)

    for path in candidates:
        if os.path.exists(path):
            load = loader.LoadLibrary if loader is not None else CDLL
            return load(path)

    try:
        os.makedirs(os.path.dirname(primary), exist_ok=True)
    except OSError:
        pass

    raise FileNotFoundError(
        f"找不到 {vendor_id} CAN 驱动 {name}。\n"
        f"本插件不附带厂商 DLL。请把官方驱动放到：\n"
        f"    {os.path.dirname(primary)}\n"
        + (f"{hint}\n" if hint else "")
        + f"也可以把驱动放到其他目录，并设置环境变量 {env_var}。\n"
        f"已查找：{candidates}"
    )
