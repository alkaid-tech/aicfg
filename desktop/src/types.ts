export interface Skill {
  id: string;
  name: string;
  source: string;
  source_ref?: string;
  skill_path: string;
  revision: string;
  content_hash: string;
  description: string;
}
export interface SkillRef {
  skill_id: string;
  revision: string;
}
export interface Preset {
  id: string;
  name: string;
  skills: SkillRef[];
  rules: string[];
  includes: string[];
}
export interface Rule {
  id: string;
  name: string;
  paths: string[];
  body: string;
}
export interface Config {
  schema_version: number;
  library: Skill[];
  presets: Preset[];
  rules: Rule[];
}
export interface TargetConfig {
  presets: string[];
  excluded: string[];
  agents: string[];
  versions: Record<string, string>;
}
export interface Target {
  id: string;
  name: string;
  path: string;
  identity: string;
  repair: boolean;
  managed: Record<string, string>;
  applied: string;
  installed?: Resolution["skills"];
}
export interface TargetView {
  target: Target;
  config: TargetConfig;
  status: string;
  error: string | null;
}
export interface State {
  root: string | null;
  config: Config;
  targets: TargetView[];
  git_status: string;
}
export interface Candidate {
  skill: Skill;
  markdown: string;
}
export interface Change {
  path: string;
  kind: string;
  before: string;
  after: string;
  conflict: boolean;
}
export interface Resolution {
  skills: { skill: Skill; revision: string; install_name: string }[];
  rules: Rule[];
  conflicts: Record<string, string[]>;
}
export interface Preview {
  token: string;
  changes: Change[];
  resolution: Resolution;
}
export interface Response {
  state: State;
  notice: string | null;
  candidates: Candidate[] | null;
  preview: Preview | null;
  markdown: string | null;
  updates: Skill[] | null;
}
export interface Request {
  action: string;
  data?: Record<string, unknown>;
}
