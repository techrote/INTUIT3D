"""Bounded L-profile sketch admission tests (not a pinned C++ physical pass)."""
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from occt8_profile_contract import (
    validate_profile_request, canonical_profile_request, expected_profile_metrics)
from occt8_bridge import canonical_request
FIXTURE = {
  "protocol":"intuit3d/kernel/l-profile-cut-chain-v3",
  "requestId":"lbracket.8","featureId":"body.lbracket","revision":8,
  "units":"mm","exportStep":True,
  "profile":{"profileId":"sketch.lbracket","width":120,"depth":80,
             "thickness":8,"legWidth":30,"footHeight":20},
  "cuts":[{"featureId":"pocket.blind","kind":"circle","x":-45,"y":10,
           "radius":5,"cutDepthMm":3},
          {"featureId":"window.through","kind":"rectangle","x":15,
           "y":-30,"width":10,"depth":8,"cutDepthMm":8}],
}
class LProfileTests(unittest.TestCase):
    def test_canonical_and_dimensional_edit(self):
        q = validate_profile_request(FIXTURE)
        self.assertEqual(canonical_request(q),canonical_profile_request(q))
        self.assertIn("INTUIT3D_OCCT8_L_PROFILE_CHAIN_V3",canonical_request(q))
        self.assertIn("sketch.lbracket 120 80 8 30 20 0 2",canonical_request(q))
        a,_ = expected_profile_metrics(q)
        updated=json.loads(json.dumps(q))
        updated["profile"]["thickness"]=12
        updated["cuts"][0]["cutDepthMm"]=5
        updated["cuts"][1]["cutDepthMm"]=12
        b,_=expected_profile_metrics(validate_profile_request(updated))
        self.assertGreater(b,a)
        self.assertEqual(updated["featureId"],q["featureId"])
        self.assertEqual([x["featureId"] for x in updated["cuts"]],
                         [x["featureId"] for x in q["cuts"]])
    def test_notch_does_not_accept_tool_in_empty_space(self):
        updated=json.loads(json.dumps(FIXTURE))
        updated["cuts"][0]["x"]=10
        updated["cuts"][0]["y"]=10
        with self.assertRaisesRegex(ValueError,"outside selected L-profile"):
            validate_profile_request(updated)
    def test_touching_and_duplicate_identity_rejected(self):
        updated=json.loads(json.dumps(FIXTURE))
        updated["cuts"][0]["featureId"]=updated["profile"]["profileId"]
        with self.assertRaisesRegex(ValueError,"conflicts"):
            validate_profile_request(updated)
        updated=json.loads(json.dumps(FIXTURE))
        updated["cuts"][0]["x"]=-30
        with self.assertRaises(ValueError):
            validate_profile_request(updated)
if __name__=="__main__":
    unittest.main()
