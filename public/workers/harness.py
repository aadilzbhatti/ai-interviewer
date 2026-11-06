import json
import copy
import time
import traceback


def _norm(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, (list, tuple)):
        return [_norm(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return sorted([_norm(x) for x in v], key=_key)
    if isinstance(v, dict):
        return {str(k): _norm(x) for k, x in v.items()}
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, (int, float, str)) or v is None:
        return v
    return repr(v)


def _key(v):
    return json.dumps(v, sort_keys=True, default=repr)


def _eq(a, b, approx):
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if approx:
            return abs(a - b) <= 1e-9 + 1e-9 * max(abs(a), abs(b))
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_eq(x, y, approx) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return sorted(a.keys()) == sorted(b.keys()) and all(_eq(a[k], b[k], approx) for k in a)
    return a == b


def _to_snake(name):
    out = []
    for i, ch in enumerate(name):
        if ch.isupper() and i > 0 and (name[i - 1].islower() or name[i - 1].isdigit()):
            out.append("_")
        elif (
            ch.isupper()
            and i > 0
            and name[i - 1].isupper()
            and i + 1 < len(name)
            and name[i + 1].islower()
        ):
            out.append("_")
        out.append(ch.lower())
    return "".join(out)


def _to_camel(name):
    parts = [p for p in _to_snake(name).split("_") if p]
    if not parts:
        return name
    return parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:])


def _name_variants(name):
    """Spellings the harness will accept. Mirrors public/workers/names.js.

    The generator writes idiomatic code per language, so a question declaring
    "min_processing_rate" ships a JavaScript reference called
    "minProcessingRate". Accepting only the declared spelling made every
    JavaScript run on such a question fail every case.
    """
    out = []
    for candidate in (name, _to_snake(name), _to_camel(name)):
        if candidate and candidate.isidentifier() and candidate not in out:
            out.append(candidate)
    return out


def _make_validator(code):
    """Compiles the question's check(args, output) -> bool, if it has one."""
    if not code:
        return None
    scope = {"__name__": "__validator__"}
    exec(code, scope)
    fn = scope.get("check")
    return fn if callable(fn) else None


def _compare(actual, expected, mode):
    a = _norm(actual)
    e = _norm(expected)
    if mode in ("sorted", "set") and isinstance(a, list) and isinstance(e, list):
        a = sorted(a, key=_key)
        e = sorted(e, key=_key)
    return _eq(a, e, mode == "approx"), a, e


def _run(payload):
    namespace = {"__name__": "__candidate__"}
    top_error = None
    try:
        exec(payload["code"], namespace)
    except Exception as exc:  # noqa: BLE001
        top_error = "".join(traceback.format_exception_only(type(exc), exc)).strip()

    names = _name_variants(payload["functionName"])
    fn = None
    for candidate in names:
        found = namespace.get(candidate)
        if callable(found):
            fn = found
            break
    if top_error is None and not callable(fn):
        top_error = "No function named %s was defined." % " or ".join("'%s'" % n for n in names)

    validator = None
    if top_error is None and (payload.get("comparison") == "validator"):
        try:
            validator = _make_validator(payload.get("validator"))
        except Exception as exc:  # noqa: BLE001
            top_error = "The question's validator did not compile: " + "".join(
                traceback.format_exception_only(type(exc), exc)
            ).strip()
        if top_error is None and validator is None:
            top_error = "This question uses validator comparison but supplies no check() function."

    results = []
    if top_error is None:
        mode = payload.get("comparison") or "exact"
        for t in payload["tests"]:
            t0 = time.time()
            name = t.get("name") or "case"
            entry = {
                "name": name,
                "hidden": bool(t.get("hidden")),
                "args": _key(_norm(t["args"])),
            }
            try:
                out = fn(*copy.deepcopy(t["args"]))
                if validator is not None:
                    verdict = validator(copy.deepcopy(t["args"]), copy.deepcopy(out))
                    entry["passed"] = bool(verdict)
                    entry["expected"] = "any valid answer"
                    entry["actual"] = _key(_norm(out))
                else:
                    ok, norm_a, norm_e = _compare(out, t["expected"], mode)
                    entry["passed"] = ok
                    entry["expected"] = _key(norm_e)
                    entry["actual"] = _key(norm_a)
            except Exception as exc:  # noqa: BLE001
                entry["passed"] = False
                entry["expected"] = _key(_norm(t["expected"]))
                entry["error"] = "".join(
                    traceback.format_exception_only(type(exc), exc)
                ).strip()
            entry["durationMs"] = int((time.time() - t0) * 1000)
            results.append(entry)

    return json.dumps({"results": results, "error": top_error})


SCRATCH_FILE = "<your code>"
_STDOUT_CAP = 20000


def _candidate_lineno(exc):
    """Where in THEIR file it happened, ignoring this harness's own frames."""
    if isinstance(exc, SyntaxError) and exc.lineno:
        return exc.lineno
    frames = [
        f
        for f in traceback.extract_tb(exc.__traceback__)
        if f.filename == SCRATCH_FILE
    ]
    return frames[-1].lineno if frames else None


def _candidate_traceback(exc):
    """A traceback with only the candidate's frames in it.

    The full one is mostly this file — exec, _scratch, the driver — which tells
    them nothing about their own code and buries the line that does.
    """
    frames = [
        f
        for f in traceback.extract_tb(exc.__traceback__)
        if f.filename == SCRATCH_FILE
    ]
    head = (
        "Traceback (most recent call last):\n" + "".join(traceback.format_list(frames))
        if frames
        else ""
    )
    return (head + "".join(traceback.format_exception_only(type(exc), exc))).strip()


def _scratch(payload):
    """The candidate's file run as a program, plus one optional call.

    Nothing here touches the question's tests, and nothing it returns is shaped
    like a test result: this is theirs to run as often as they like.
    """
    import contextlib
    import io

    code = payload.get("code") or ""
    call = (payload.get("call") or "").strip()
    out = io.StringIO()

    def done(**kw):
        text = out.getvalue()
        if len(text) > _STDOUT_CAP:
            text = text[:_STDOUT_CAP] + "\n...output truncated..."
        kw.setdefault("results", [])
        return json.dumps(dict(kw, stdout=text))

    try:
        compiled = compile(code, SCRATCH_FILE, "exec")
    except SyntaxError as exc:
        return done(ok=False, phase="compile", error=_candidate_traceback(exc), where=_candidate_lineno(exc))

    call_compiled = None
    if call:
        try:
            call_compiled = compile(call, "<call>", "eval")
        except SyntaxError as exc:
            return done(
                ok=False,
                phase="call",
                error="".join(traceback.format_exception_only(type(exc), exc)).strip(),
            )

    namespace = {"__name__": "__main__"}
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        try:
            exec(compiled, namespace)
        except BaseException as exc:  # noqa: BLE001 — including SystemExit
            return done(ok=False, phase="run", error=_candidate_traceback(exc), where=_candidate_lineno(exc))

        if call_compiled is None:
            return done(ok=True, hasValue=False)

        try:
            value = eval(call_compiled, namespace)  # noqa: S307
        except BaseException as exc:  # noqa: BLE001
            return done(ok=False, phase="call", error=_candidate_traceback(exc), where=_candidate_lineno(exc))

    return done(ok=True, hasValue=True, value=_key(_norm(value)))


_payload = json.loads(__payload)  # noqa: F821
_result = _scratch(_payload) if _payload.get("mode") == "scratch" else _run(_payload)
_result
