"""Controlled research lab, not production code. All HTTP requests use loopback."""
import base64
import hashlib
import http.client
import json
import platform
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

OUT = Path(__file__).parent
RESULTS = []


class Origin:
    def __init__(self, name):
        self.name = name
        self.status = 200
        self.location = None
        self.body = b"same-looking public website"
        self.paths = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                owner.paths.append(self.path)
                self.send_response(owner.status)
                if owner.location:
                    self.send_header("Location", owner.location)
                self.send_header("Content-Length", str(len(owner.body)))
                self.end_headers()
                self.wfile.write(owner.body)

            def log_message(self, *_):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:" + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.running = True

    def stop(self):
        if self.running:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join()
            self.running = False


def follow(url, max_hops=8):
    seen, trace = set(), []
    for _ in range(max_hops):
        if url in seen:
            return {"outcome": "loop", "requests": len(trace), "trace": trace}
        seen.add(url)
        p = urlsplit(url)
        if p.scheme != "http" or p.hostname != "127.0.0.1":
            return {"outcome": "disallowed", "requests": len(trace), "trace": trace}
        conn = http.client.HTTPConnection(p.hostname, p.port, timeout=0.5)
        try:
            conn.request("GET", p.path or "/")
            res = conn.getresponse()
            body = res.read(2048)
            trace.append({"url": url, "status": res.status})
            if res.status in (301, 302, 303, 307, 308):
                url = urljoin(url, res.getheader("Location"))
            else:
                return {"outcome": "reachable" if res.status == 200 else "http_error",
                        "requests": len(trace), "final": url, "trace": trace,
                        "body_sha256": hashlib.sha256(body).hexdigest()}
        except OSError as e:
            trace.append({"url": url, "error": type(e).__name__})
            return {"outcome": "unreachable", "requests": len(trace), "trace": trace}
        finally:
            conn.close()
    return {"outcome": "hop_limit", "requests": len(trace), "trace": trace}


def record(case, observed, expected, note):
    actual = observed["outcome"] if isinstance(observed, dict) else observed
    assert actual == expected, (case, actual, expected)
    RESULTS.append({"case": case, "expected": expected, "observed": observed,
                    "assertion_passed": True, "interpretation": note})


def signed(payload, key):
    data = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    sig = key.sign(data, ec.ECDSA(hashes.SHA256()))
    return {"payload": base64.b64encode(data).decode(),
            "signature_der": base64.b64encode(sig).decode()}


def verify(record, pinned, now, max_sequence, last_digest=None, revoked=False):
    if revoked:
        return "revoked"
    try:
        data = base64.b64decode(record["payload"], validate=True)
        signature = base64.b64decode(record["signature_der"], validate=True)
        pinned.verify(signature, data, ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError):
        return "invalid_signature"
    payload = json.loads(data)
    if payload["expires_at"] <= now:
        return "expired"
    if payload["sequence"] < max_sequence:
        return "rollback"
    digest = hashlib.sha256(data).hexdigest()
    if payload["sequence"] == max_sequence and last_digest and digest != last_digest:
        return "equivocation"
    if payload["site_id"] != "test-family":
        return "wrong_family"
    return "accepted"


def main():
    origins = [Origin(n) for n in ["A", "B", "C", "D", "CLONE"]]
    a, b, c, d, clone = origins
    try:
        a.status, a.location = 301, b.url + "/page"
        b.status, b.location = 308, c.url + "/page"
        learned = follow(a.url + "/page")
        record("H01_live_chain", learned, "reachable", "A -> B -> C takes three HTTP requests.")
        assert learned["requests"] == 3
        compressed = learned["final"]
        a.stop()
        record("H02_dead_first_origin", follow(a.url + "/page"), "unreachable",
               "An ordinary redirect walker cannot read the next pointer from a dead origin.")
        record("H03_cached_next_pointer", follow(b.url + "/page"), "reachable",
               "A previously learned A -> B pointer permits starting at B.")
        b.stop()
        record("H04_dead_intermediate", follow(b.url + "/page"), "unreachable",
               "Knowing only the immediate next pointer fails when that intermediate dies.")
        compressed_result = follow(compressed)
        record("H05_compressed_history", compressed_result, "reachable",
               "Previously learned A -> C survives loss of A and B, while C is still live.")
        assert compressed_result["requests"] == 1
        c.status, c.location = 301, d.url + "/page"
        record("H06_live_tail_moves", follow(compressed), "reachable",
               "A cached terminal can reveal another move while the terminal still forwards.")
        c.stop()
        record("H07_unobserved_tail_move", follow(compressed), "unreachable",
               "A cached A -> C cannot discover D after C dies if C -> D was never learned.")

        key = ec.generate_private_key(ec.SECP256R1())
        now = 1000
        payload = {"site_id": "test-family", "sequence": 4,
                   "origin": d.url, "expires_at": 2000}
        valid = signed(payload, key)
        record("S01_signed_update", verify(valid, key.public_key(), now, 3), "accepted",
               "A pretrusted key can authenticate a separately obtained new pointer.")
        record("H08_registry_recovery", follow(payload["origin"] + "/page"), "reachable",
               "The signed registry supplies D without contacting dead A, B or C.")
        forged = deepcopy(valid)
        forged_payload = dict(payload, origin=clone.url)
        forged["payload"] = base64.b64encode(json.dumps(forged_payload).encode()).decode()
        record("S02_tamper", verify(forged, key.public_key(), now, 3), "invalid_signature",
               "Changing a signed destination invalidates its signature.")
        rogue_key = ec.generate_private_key(ec.SECP256R1())
        record("S03_wrong_key", verify(signed(payload, rogue_key), key.public_key(), now, 3),
               "invalid_signature", "A lookalike cannot replace a previously pinned owner key.")
        record("S04_expired", verify(valid, key.public_key(), 2001, 3), "expired",
               "A valid signature does not make an expired pointer current.")
        record("S05_rollback", verify(valid, key.public_key(), now, 5), "rollback",
               "Client sequence memory rejects older signed records.")
        original_digest = hashlib.sha256(base64.b64decode(valid["payload"])).hexdigest()
        conflict = signed(dict(payload, origin=clone.url), key)
        record("S06_same_sequence_conflict", verify(conflict, key.public_key(), now, 4, original_digest),
               "equivocation", "Conflicting records at an observed sequence require refusal.")
        record("S07_revoked", verify(valid, key.public_key(), now, 3, revoked=True), "revoked",
               "Locally known revocation overrides an otherwise valid signature.")
        record("S08_compromised_trusted_key", verify(conflict, key.public_key(), now, 3), "accepted",
               "LIMITATION: the signature alone cannot distinguish an attacker using the legitimate key.")
        left, right = follow(d.url + "/page"), follow(clone.url + "/page")
        assert left["body_sha256"] == right["body_sha256"]
        record("I01_identical_clone", "indistinguishable_by_content", "indistinguishable_by_content",
               "Both unrelated origins return identical HTTP 200 bodies; content equality cannot prove identity.")
        d.status, d.location = 302, clone.url + "/page"
        clone.status, clone.location = 302, d.url + "/page"
        record("H09_cycle", follow(d.url + "/page"), "loop", "Visited-URL detection terminates a redirect cycle.")
        record("H10_hop_bound", follow(d.url + "/page", max_hops=1), "hop_limit",
               "A hard budget prevents unbounded work.")
        report = {"executed_at_utc": datetime.now(timezone.utc).isoformat(),
                  "python": platform.python_version(), "scope": "Loopback HTTP and P-256 cryptographic unit experiments",
                  "limitations": ["No internet-wide dataset", "No DNS/TLS simulation", "No browser cache simulation",
                                  "Ephemeral keys and origins", "Toy DER signature envelope, not production JWS",
                                  "Expected negative outcomes count as passed assertions, not successful recoveries"],
                  "passed_assertions": len(RESULTS), "results": RESULTS}
        (OUT / "redirect_lab_results.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"passed_assertions": len(RESULTS), "results": [{"case": r["case"], "observed":
            r["observed"].get("outcome") if isinstance(r["observed"], dict) else r["observed"]} for r in RESULTS]}, indent=2))
    finally:
        for origin in origins:
            origin.stop()


if __name__ == "__main__":
    main()
