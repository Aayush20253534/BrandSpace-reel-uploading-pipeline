import assert from "node:assert/strict";
import test from "node:test";
import { isPermanentMediaFailure, MediaToolError } from "./index";

test("permanent malformed-media failures invalidate an asset", () => {
  assert.equal(
    isPermanentMediaFailure(
      new MediaToolError("missing video", "VIDEO_STREAM_MISSING"),
    ),
    true,
  );
  assert.equal(
    isPermanentMediaFailure(
      new MediaToolError("empty download", "MEDIA_DOWNLOAD_INVALID"),
    ),
    true,
  );
});

test("transient tool failures do not invalidate an asset", () => {
  assert.equal(
    isPermanentMediaFailure(
      new MediaToolError("timeout", "MEDIA_TOOL_TIMEOUT"),
    ),
    false,
  );
  assert.equal(
    isPermanentMediaFailure(
      new MediaToolError("tool failure", "MEDIA_TOOL_FAILED"),
    ),
    false,
  );
  assert.equal(isPermanentMediaFailure(new Error("network")), false);
});
