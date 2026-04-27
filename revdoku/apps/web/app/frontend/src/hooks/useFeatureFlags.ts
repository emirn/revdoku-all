import { useEffect, useState } from 'react';
import { getApiConfig, FeaturesConfig } from '../config/api';

const DEFAULTS: FeaturesConfig = {
  diff_viewer: false,
  batch_review: false,
  api_key_management: false,
  per_page_view: false,
  sessions_management: false,
  checklist_versions: false,
  one_time_credits: false,
};

export function useFeatureFlags(): FeaturesConfig {
  const [features, setFeatures] = useState<FeaturesConfig>(DEFAULTS);

  useEffect(() => {
    getApiConfig().then(config => {
      if (config.features) setFeatures(config.features);
    });
  }, []);

  return features;
}
