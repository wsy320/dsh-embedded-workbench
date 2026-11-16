"""CAN device registry.

The manifest is the single source of truth shared by Python and the Host/UI.
Adding a vendor means adding its Python package plus one ``devices`` entry;
no factory branch in ``bus.py`` is required.
"""

import importlib
import json
import os

_MANIFEST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'devices.json')


def load_devices():
    """Return the manifest device list, or an empty list if malformed."""
    try:
        with open(_MANIFEST, 'r', encoding='utf-8') as handle:
            data = json.load(handle)
        devices = data.get('devices', [])
        return [item for item in devices if isinstance(item, dict) and item.get('id')]
    except (OSError, ValueError):
        return []


def device_ids():
    return [item['id'] for item in load_devices()]


def create_bus(kind, bitrate=500000, data_bitrate=2000000):
    """Instantiate a registered bus by id."""
    spec = next((item for item in load_devices() if item['id'] == kind), None)
    if spec is None:
        raise ValueError(f"unknown CAN device: {kind!r}")
    target = spec.get('bus') or ''
    module_name, _, class_name = target.partition(':')
    if not module_name or not class_name:
        raise ValueError(f"invalid bus target for {kind!r}: {target!r}")
    module = importlib.import_module(module_name)
    bus_class = getattr(module, class_name)
    return bus_class(bitrate=bitrate, data_bitrate=data_bitrate)
