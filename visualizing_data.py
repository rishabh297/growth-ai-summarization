import pandas as pd
import plotly.graph_objects as go

# Load the aggregated data
visits_merged = pd.read_csv("/Users/rishabhgoel/Desktop/Harvard/Zak Lab/P3 Project/combined_visits_aggregated.csv")

# Choose a patient to visualize
patient_id = "P0013508"
df_patient = visits_merged[visits_merged["patient_id"] == patient_id].copy()

# Sort visits by age_in_days to get the timeline in order
df_patient = df_patient.sort_values("age_in_days")

# Define a discrete color mapping for encounter types
color_mapping = {
    "Office Visit": "#1f77b4",
    "Consult": "#ff7f0e",
    "Well Visit (Conv.)": "#2ca02c",
    "Telemedicine": "#d62728",
    "Telephone": "#9467bd"
}
# Map the encounter types to colors (use a default color if encounter_type is not in mapping)
colors = df_patient["encounter_type"].map(color_mapping).fillna("#8c564b")

# Create a new figure
fig = go.Figure()

# Add a dashed line connecting the visits
fig.add_trace(go.Scatter(
    x=df_patient["age_in_days"],
    y=[0] * len(df_patient),
    mode="lines",
    line=dict(color="gray", dash="dash"),
    showlegend=False
))

# Add scatter markers for each visit
fig.add_trace(go.Scatter(
    x=df_patient["age_in_days"],
    y=[0] * len(df_patient),
    mode="markers",
    marker=dict(
        size=12,
        symbol="circle",
        color=colors,
        line=dict(width=1, color="DarkSlateGrey")
    ),
    customdata=df_patient[["visit_id", "encounter_type", "medications_details", "labs_details", "referrals_details", "patient_problems"]].values,
    hovertemplate=(
        "<b>Visit ID:</b> %{customdata[0]}<br>" +
        "<b>Age (days):</b> %{x}<br>" +
        "<b>Encounter:</b> %{customdata[1]}<br><br>" +
        "<b>Medications:</b> %{customdata[2]}<br>" +
        "<b>Labs:</b> %{customdata[3]}<br>" +
        "<b>Referrals:</b> %{customdata[4]}<br>" +
        "<b>Problems:</b> %{customdata[5]}<extra></extra>"
    )
))

# Update layout for a clean, modern look
fig.update_layout(
    template="simple_white",
    title={
        'text': f"<b>Patient Journey Timeline for {patient_id}</b>",
        'x': 0.5,
        'xanchor': 'center'
    },
    xaxis_title="Age in Days (Visit)",
    yaxis=dict(visible=False),
    hovermode="closest",
    margin=dict(l=40, r=40, t=60, b=40),
    font=dict(family="Arial, sans-serif", size=12, color="black"),
    showlegend=False
)

# Update x-axis grid and zero line for improved readability
fig.update_xaxes(
    showgrid=True,
    gridcolor="lightgray",
    zeroline=True,
    zerolinecolor="lightgray"
)

fig.show()
