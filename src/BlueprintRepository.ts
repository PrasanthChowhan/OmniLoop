import * as fs from 'fs';

export interface Feature {
  id: string;
  description: string;
  passes: boolean;
  githubIssueNumber?: number;
  githubRepo?: string;
}

export interface BlueprintRepository {
  getFeatures(): Feature[];
  saveFeatures(features: Feature[]): void;
  getNextIncompleteFeature(): Feature | undefined;
  markFeaturePassed(id: string): void;
  markFeatureFailed(id: string): void;
  rollbackFeature(id: string): void;
}

export class JsonBlueprintRepository implements BlueprintRepository {
  constructor(private filepath: string) {}

  private loadJson(defaultVal: any = { features: [] }): any {
    if (!fs.existsSync(this.filepath)) {
      return defaultVal;
    }
    try {
      const data = fs.readFileSync(this.filepath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return defaultVal;
    }
  }

  private saveJson(data: any): void {
    fs.writeFileSync(this.filepath, JSON.stringify(data, null, 2), 'utf-8');
  }

  getFeatures(): Feature[] {
    const data = this.loadJson();
    return data.features || [];
  }

  saveFeatures(features: Feature[]): void {
    const data = this.loadJson();
    data.features = features;
    this.saveJson(data);
  }

  getNextIncompleteFeature(): Feature | undefined {
    return this.getFeatures().find(f => !f.passes);
  }

  markFeaturePassed(id: string): void {
    const features = this.getFeatures();
    const feature = features.find(f => String(f.id) === String(id));
    if (feature) {
      feature.passes = true;
      this.saveFeatures(features);
    }
  }

  markFeatureFailed(id: string): void {
    const features = this.getFeatures();
    const feature = features.find(f => String(f.id) === String(id));
    if (feature) {
      feature.passes = false;
      this.saveFeatures(features);
    }
  }

  rollbackFeature(id: string): void {
    this.markFeatureFailed(id);
  }
}
