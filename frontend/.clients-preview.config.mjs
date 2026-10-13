import { mergeConfig } from 'vite';
import config from './vite.config.ts';
export default mergeConfig(config, { server: { proxy: { '/api': 'http://127.0.0.1:8011' } } });
