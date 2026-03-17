import pandas as pd
import numpy as np
import os
from datetime import datetime
from sklearn.ensemble import RandomForestClassifier

# 1. 核心系统配置 (Abstracted System Configuration)
class MaintenanceConfig:
    # 6维健康评估权重 (可调参数)
    # 权重反映了不同维度对设备总健康度的贡献
    DEFAULT_WEIGHTS = {
        'UPDT': 0.30,        # Unplanned Downtime Rate (非计划停机)
        'Quality': 0.20,     # Quality Issue Count (质量指标)
        'RunTime': 0.30,     # Production Volume/Cycle Capacity (运行产能)
        'PM_Cycle': 0.10,    # Preventive Maintenance Aging (维护周期老化)
        'Energy': 0.05,      # Energy Drift/Anomalies (能耗漂移)
        'Predictive': 0.05   # AI Trend Prediction Score (预测性趋势)
    }

    # 业务安全红线 (Safety Limits)
    LIMITS = {
        'MAX_MAINTENANCE_INTERVAL_DAYS': 180, 
        'MAX_QUALITY_INCIDENTS': 4
    }

    # 设备分群与敏感度定义 (Asset Categorization)
    # 已将真实的机台 ID 替换为通用类型
    ASSET_GROUPS = {
        'High_Precision': { 
            'ids': [101, 102], # 示例 ID
            'updt_thresholds': [0.04, 0.06, 0.08, 0.10, 0.12] 
        },
        'Standard_Production': { 
            'ids': [201, 202, 203], 
            'updt_thresholds': [0.07, 0.09, 0.11, 0.13, 0.15] 
        },
        'Multi_Stage_Complex': { 
            'ids': [301, 302], 
            'updt_thresholds': [0.06, 0.08, 0.10, 0.12, 0.14] 
        }
    }

# 2. 动态权重优化器 (AI Weight Optimizer)
class AIWeightOptimizer:
    """使用随机森林分析历史数据特征重要性，动态调整评估权重"""
    def __init__(self, engine_instance):
        self.engine = engine_instance
        self.model = RandomForestClassifier(n_estimators=100, random_state=42)

    def optimize(self, df_history):
        if len(df_history) < 10:
            return MaintenanceConfig.DEFAULT_WEIGHTS

        X, y = [], []
        for _, row in df_history.iterrows():
            try:
                scores = self.engine.calculate_scores(row)
                if scores['Total'] >= 95: continue # 排除强制熔断项干扰

                features = [
                    scores['UPDT'], scores['Quality'], scores['RunTime'],
                    scores['PM_Cycle'], scores['Energy'], scores['Predictive']
                ]
                # 标注：总分超过 60 定义为需要关注的资产
                label = 1 if scores['Total'] >= 60 else 0
                X.append(features)
                y.append(label)
            except: continue

        if not X: return MaintenanceConfig.DEFAULT_WEIGHTS

        self.model.fit(X, y)
        importances = self.model.feature_importances_
        keys = list(MaintenanceConfig.DEFAULT_WEIGHTS.keys())

        # 归一化处理并设置 3% 兜底权重
        new_weights = {k: max(imp, 0.03) for k, imp in zip(keys, importances)}
        factor = 1.0 / sum(new_weights.values())
        return {k: round(v * factor, 3) for k, v in new_weights.items()}

# 3. 专家诊断建议引擎 (Expert Advisory Engine)
class AdvisoryEngine:
    """基于工业领域知识的启发式诊断逻辑"""
    @staticmethod
    def get_advice(scores, asset_info):
        advice = []
        
        # 逻辑示例：能耗异常但生产正常 (潜在摩擦/润滑问题)
        if scores['Energy'] >= 80 and scores['Quality'] < 25 and scores['UPDT'] < 25:
            advice.append("🛢️ [Lubrication Alert] High energy consumption with normal output. Check for mechanical friction or lubrication blockage.")

        # 逻辑示例：新维护后的高故障率 (维修质量问题)
        if asset_info['days_since_pm'] <= 14 and scores['UPDT'] >= 40:
            advice.append("📉 [Post-PM Instability] High downtime immediately after maintenance. Verify assembly precision or root cause resolution.")

        # 资产类型特定建议
        if "Complex" in asset_info['group']:
            if scores['UPDT'] >= 60: advice.append("⚙️ [Complex Linkage] Inspect synchronization mechanisms and multi-stage connectors.")

        if scores['Total'] >= 100:
            advice.insert(0, "🛑 [CRITICAL] Safety limit reached. Mandatory inspection required.")

        return " | ".join(advice) if advice else "✅ [Stable] System performing within normal parameters."

# 4. 健康评估核心系统 (Core Health System)
class AssetHealthSystem:
    def __init__(self, use_ai=True):
        self.weights = MaintenanceConfig.DEFAULT_WEIGHTS
        self.use_ai = use_ai
        self.asset_map = {}
        for name, data in MaintenanceConfig.ASSET_GROUPS.items():
            for aid in data['ids']:
                self.asset_map[aid] = (name, data['updt_thresholds'])

    def _sanitize_input(self, val):
        try:
            return float(str(val).replace('%', '').strip()) if val else 0.0
        except: return 0.0

    def calculate_scores(self, row):
        # 数据清洗与预处理
        aid = int(self._sanitize_input(row.get('Asset_ID')))
        updt_rate = self._sanitize_input(row.get('Downtime_Rate')) / 100.0
        quality_cnt = int(self._sanitize_input(row.get('Quality_Issues')))
        
        # 获取资产特定的阈值
        group_name, thresholds = self.asset_map.get(aid, ('Standard', [0.05, 0.07, 0.09, 0.11, 0.13]))

        # 打分逻辑 (示例：停机率评分)
        s_updt = 0
        for i, thr in enumerate(reversed(thresholds)):
            if updt_rate > thr: s_updt = [100, 80, 60, 40, 20][i]; break

        # 综合评分计算
        scores = {
            'UPDT': s_updt,
            'Quality': 100 if quality_cnt >= MaintenanceConfig.LIMITS['MAX_QUALITY_INCIDENTS'] else quality_cnt * 25,
            'RunTime': min(100, self._sanitize_input(row.get('Run_Volume_Rate'))),
            'PM_Cycle': min(100, self._sanitize_input(row.get('Aging_Rate'))),
            'Energy': min(100, self._sanitize_input(row.get('Energy_Drift')) * 10),
            'Predictive': self._sanitize_input(row.get('AI_Trend_Score', 0))
        }

        total = sum(scores[k] * self.weights[k] for k in scores)
        
        # 红线强制限制
        if quality_cnt >= MaintenanceConfig.LIMITS['MAX_QUALITY_INCIDENTS']: total = 100
        
        scores['Total'] = total
        scores['Group'] = group_name
        return scores

    def process_data(self, input_csv):
        df = pd.read_csv(input_csv)
        # 业务逻辑：锁定最新日期的数据进行分析
        df['date_dt'] = pd.to_datetime(df['Timestamp'])
        latest_date = df['date_dt'].max()
        target_batch = df[df['date_dt'] == latest_date].copy()

        # AI 动态权重训练
        if self.use_ai:
            history = df[df['date_dt'] < latest_date]
            optimizer = AIWeightOptimizer(self)
            self.weights = optimizer.optimize(history)

        results = []
        for _, row in target_batch.iterrows():
            sc = self.calculate_scores(row)
            asset_info = {
                'days_since_pm': self._sanitize_input(row.get('Days_Since_PM')),
                'group': sc['Group']
            }
            
            results.append({
                'Asset_ID': row.get('Asset_ID'),
                'Health_Score': round(sc['Total'], 1),
                'Advisory': AdvisoryEngine.get_advice(sc, asset_info),
                'AI_Weights_Used': str(self.weights)
            })

        return pd.DataFrame(results)

if __name__ == "__main__":
    # 使用方式示例
    system = AssetHealthSystem(use_ai=True)
    # final_report = system.process_data('industrial_data_sample.csv')
    # final_report.to_csv('maintenance_report.csv', index=False)
    print("Asset Health System Initialized.")
