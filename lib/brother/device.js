// ╭────────────────────────────╮
// │  brother/device.js        │
// │  Linux USB device I/O     │
// │  for Brother P-touch      │
// │  printers via /dev/usb    │
// ╰────────────────────────────╯
const fs   = require('fs');
const path = require('path');
const { isBrotherDevice, lookupModel } = require('./models');
const { STATUS_RESPONSE_LENGTH } = require('./protocol');

const SYS_USB_MISC = '/sys/class/usbmisc';

// Scan /sys/class/usbmisc for USB printer devices whose vendor matches
// Brother's ID (04f9).  Returns entries with the /dev path, USB IDs, and
// any model info available from the database.
const discoverDevices = async () => {
  if (process.platform !== 'linux') {
    return [];
  }

  let entries;

  try {
    entries = await fs.promises.readdir(SYS_USB_MISC);
  } catch {
    return [];
  }

  const lpEntries = entries.filter(entry => entry.startsWith('lp'));
  const devices = [];

  for (const entry of lpEntries) {
    try {
      const ifacePath = await fs.promises.realpath(
        path.join(SYS_USB_MISC, entry, 'device')
      );
      const deviceDir = path.dirname(ifacePath);
      const vendorId = (await fs.promises.readFile(
        path.join(deviceDir, 'idVendor'), 'utf8'
      )).trim().toLowerCase();
      const productId = (await fs.promises.readFile(
        path.join(deviceDir, 'idProduct'), 'utf8'
      )).trim().toLowerCase();

      if (!isBrotherDevice(vendorId)) {
        continue;
      }

      const model = lookupModel(productId);

      devices.push({
        path: `/dev/usb/${entry}`,
        vendorId,
        productId,
        modelName: model?.name || null,
        headWidthPx: model?.headWidthPx || null,
        dpi: model?.dpi || null,
      });
    } catch {
      // Device may have been unplugged during enumeration.
    }
  }

  return devices;
};

// Resolve which /dev/usb/lp* path to use for this print job.  An explicit
// path in the config takes priority; otherwise we pick the first discovered
// Brother device.
const resolveDevicePath = async configuredPath => {
  if (configuredPath) {
    try {
      await fs.promises.access(configuredPath, fs.constants.W_OK);
      return configuredPath;
    } catch {
      return null;
    }
  }

  const devices = await discoverDevices();
  return devices.length > 0 ? devices[0].path : null;
};

// Open the device for bidirectional communication.  The returned handle
// must be closed with closeDevice() when the job is finished.
const openDevice = async devicePath => {
  const fd = await fs.promises.open(devicePath, fs.constants.O_RDWR);
  return fd;
};

const writeToDevice = async (fd, data) => {
  await fd.write(data);
};

// Read exactly `length` bytes from the device.  USB bulk reads may return
// short, so we loop until the full response is collected or the timeout
// fires.
const readFromDevice = async (fd, length, timeoutMs = 5000) => {
  const result = Buffer.alloc(length);
  let offset = 0;
  const deadline = Date.now() + timeoutMs;

  while (offset < length) {
    if (Date.now() > deadline) {
      throw new Error(`Read timed out after ${timeoutMs}ms (got ${offset}/${length} bytes)`);
    }

    try {
      const { bytesRead } = await fd.read(result, offset, length - offset, null);

      if (bytesRead > 0) {
        offset += bytesRead;
      } else {
        // Short read; brief pause before retrying to avoid busy-spinning
        // on the file descriptor.
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    } catch (error) {
      if (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK') {
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }

      throw error;
    }
  }

  return result;
};

const closeDevice = async fd => {
  try {
    await fd.close();
  } catch {
    // Already closed or detached.
  }
};

// Quick connectivity check that opens the device, sends a status request,
// and parses the response without printing anything.
const probeDevice = async devicePath => {
  const { buildInvalidate, buildInitialize, buildStatusRequest, parseStatusResponse } = require('./protocol');

  let fd;

  try {
    fd = await openDevice(devicePath);
    await writeToDevice(fd, buildInvalidate());
    await writeToDevice(fd, buildInitialize());
    await writeToDevice(fd, buildStatusRequest());

    const response = await readFromDevice(fd, STATUS_RESPONSE_LENGTH, 3000);
    return parseStatusResponse(response);
  } finally {
    if (fd) await closeDevice(fd);
  }
};

module.exports = {
  discoverDevices,
  resolveDevicePath,
  openDevice,
  writeToDevice,
  readFromDevice,
  closeDevice,
  probeDevice,
};
