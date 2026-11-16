"""CAN 消息、设备基类与通用 FD 长度映射。"""



def get_fd_len(length):
    """Map a payload length to the nearest legal CAN FD DLC."""
    if length <= 8:
        return length
    if length <= 12:
        return 12
    if length <= 16:
        return 16
    if length <= 20:
        return 20
    if length <= 24:
        return 24
    if length <= 32:
        return 32
    if length <= 48:
        return 48
    if length <= 64:
        return 64
    return None


class CanMessage:
    """Unified CAN/CANFD message, platform-independent."""

    def __init__(self, can_id=0, data=None, fd=0, timestamp=None, channel=0):
        self.can_id = can_id
        self.data = list(data) if data is not None else []
        self.fd = fd
        self.timestamp = timestamp
        self.channel = channel

    @property
    def len(self):
        return len(self.data)

    def __repr__(self):
        data_str = " ".join(f"{b:02X}" for b in self.data)
        return f"CanMessage(CANID={hex(self.can_id)}, LEN={self.len}, DATA={data_str})"


class CanDevice:
    """Abstract base class for CAN device implementations."""

    def init(self):
        """Initialize CAN device. Returns 0 on success."""
        raise NotImplementedError

    def deinit(self):
        """Deinitialize CAN device."""
        raise NotImplementedError

    def send(self, can_id, data, fd=0):
        """Send a CAN/CANFD message.

        Args:
            can_id: CAN ID (int)
            data: data bytes (list of ints)
            fd: 0=CAN 2.0, 1=CANFD

        Returns:
            >0 on success, 0 on failure
        """
        raise NotImplementedError

    def receive(self, fd=0):
        """Receive CAN/CANFD messages.

        Returns:
            list of CanMessage (empty list if no messages)
        """
        raise NotImplementedError

    def select_channel(self, channel):
        """Select CAN channel (0 or 1)."""
        raise NotImplementedError
