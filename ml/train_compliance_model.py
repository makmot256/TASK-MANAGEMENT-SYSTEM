import pandas as pd
from sklearn.ensemble import RandomForestClassifier
import joblib
import os

def train(csv_path='ml/tms_nlp_synthetic_dataset.csv'):
    df = pd.read_csv(csv_path)

    df['is_late'] = df['is_late'].astype(int)
    df['on_time'] = df['on_time'].astype(int)
    df['grammar_error_count'] = df['grammar_error_count'].astype(int)
    df['grammar_quality_score'] = df['grammar_quality_score'].astype(float)
    df['content_quality_score'] = df['content_quality_score'].astype(float)
    df['vulgar_comment'] = df['vulgar_comment'].astype(int)
    df['compliance_pass'] = df['compliance_pass'].astype(int)
    df['report_length'] = df['report_content'].apply(lambda x: len(str(x).split()))
    df['has_evidence'] = df['report_content'].apply(
        lambda x: 1 if any(w in str(x).lower() for w in [
            'attached', 'proof', 'screenshot', 'pdf', 'document',
            'evidence', 'tested', 'coverage',
        ]) else 0
    )

    features = [
        'is_late', 'on_time', 'grammar_error_count',
        'grammar_quality_score', 'content_quality_score',
        'vulgar_comment', 'report_length', 'has_evidence'
    ]

    X = df[features]
    y = df['compliance_pass']

    clf = RandomForestClassifier(n_estimators=100, random_state=42)
    clf.fit(X, y)

    accuracy = clf.score(X, y)
    print(f'Training accuracy: {accuracy:.2%}')

    os.makedirs('ml', exist_ok=True)
    joblib.dump(clf, 'ml/compliance_model.pkl')
    joblib.dump(features, 'ml/compliance_features.pkl')
    print('Model saved to ml/compliance_model.pkl')

if __name__ == '__main__':
    train()