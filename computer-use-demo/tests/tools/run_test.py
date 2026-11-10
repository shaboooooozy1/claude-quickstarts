import asyncio
import os
import time

import pytest

from computer_use_demo.tools.run import run

needs_proc = pytest.mark.skipif(
    not os.path.isdir("/proc"), reason="needs /proc to check a descendant's state"
)


def _alive(pid: int) -> bool:
    # A zombie still answers os.kill(pid, 0), so read the state from /proc instead.
    try:
        with open(f"/proc/{pid}/stat") as f:
            state = f.read().rsplit(")", 1)[1].split()[0]
    except FileNotFoundError:
        return False
    return state != "Z"


async def _expect_timeout(cmd: str, bound: float) -> None:
    # The outer bound turns a hang into a failure instead of a stuck test run.
    try:
        await asyncio.wait_for(run(cmd, timeout=0.5), timeout=bound)
    except TimeoutError as exc:
        hung = "timed out after 0.5 seconds" not in str(exc)
        assert not hung, "run() hung past its own timeout"
    else:
        pytest.fail("run() returned instead of timing out")


@pytest.mark.asyncio
async def test_run_returns_output():
    code, stdout, stderr = await run("echo hello")
    assert code == 0
    assert stdout.strip() == "hello"
    assert stderr == ""


@needs_proc
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "cmd",
    [
        "sleep 30 & echo $! > {pidfile}; wait",
        "sleep 30 | cat & echo $! > {pidfile}; wait",
    ],
    ids=["background", "pipeline"],
)
async def test_run_timeout_kills_descendants_holding_the_pipes(cmd, tmp_path):
    pidfile = tmp_path / "pid"
    start = time.monotonic()
    await _expect_timeout(cmd.format(pidfile=pidfile), bound=10)
    assert time.monotonic() - start < 5

    descendant = int(pidfile.read_text())
    for _ in range(40):
        if not _alive(descendant):
            break
        await asyncio.sleep(0.05)
    assert not _alive(descendant), "a descendant of the timed-out shell survived"


@needs_proc
@pytest.mark.asyncio
async def test_run_timeout_still_raises_when_a_descendant_escapes_the_group(tmp_path):
    pidfile = tmp_path / "pid"
    # setsid moves the sleep out of the process group, so the group kill can't reach it.
    cmd = f"setsid sleep 30 & echo $! > {pidfile}; wait"
    try:
        await _expect_timeout(cmd, bound=15)
    finally:
        if pidfile.exists() and _alive(pid := int(pidfile.read_text())):
            os.kill(pid, 9)
