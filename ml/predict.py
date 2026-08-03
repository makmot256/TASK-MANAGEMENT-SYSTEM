import sys
import json
import joblib
import numpy as np
import os

model_path = os.path.join(os.path.dirname(__file__), 'compliance_model.pkl')
features_path = os.path.join(os.path.dirname(__file__), 'compliance_features.pkl')

try:
    clf = joblib.load(model_path)
    features = joblib.load(features_path)

    args = list(map(float, sys.argv[1:]))
    X = np.array(args).reshape(1, -1)

    prediction = int(clf.predict(X)[0])
    probability = float(clf.predict_proba(X)[0][1])
    score = round(probability * 100)

    print(json.dumps({
        'compliance_pass': prediction,
        'compliance_score': score,
        'ml_available': True,
    }))

except Exception as e:
    print(json.dumps({
        'compliance_pass': None,
        'compliance_score': None,
        'ml_available': False,
        'error': str(e),
    }))