// Whether a process with this pid runs on this machine (EPERM: it does, under another user).
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}
