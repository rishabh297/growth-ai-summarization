import dash
from dash import html, dcc, Input, Output, State
import pandas as pd
import plotly.graph_objects as go
from dash.exceptions import PreventUpdate

# Initialize the Dash app
app = dash.Dash(__name__)

# Load the aggregated data
visits_merged = pd.read_csv("/Users/rishabhgoel/Desktop/Harvard/Zak Lab/P3 Project/combined_visits_aggregated.csv")

# Define a discrete color mapping for encounter types
color_mapping = {
    "Office Visit": "#1f77b4",
    "Consult": "#ff7f0e",
    "Well Visit (Conv.)": "#2ca02c",
    "Telemedicine": "#d62728",
    "Telephone": "#9467bd"
}

# Create the layout
app.layout = html.Div([
    html.Div([
        html.H1("Patient Journey Dashboard", 
                style={'textAlign': 'center', 'color': '#2c3e50', 'marginBottom': 30}),
        
        # Search box
        html.Div([
            dcc.Input(
                id='patient-search',
                type='text',
                placeholder='Enter Patient ID (e.g., P0013508)',
                style={'width': '100%', 'padding': '10px', 'fontSize': '16px'}
            ),
            html.Button('Search', id='search-button', n_clicks=0,
                       style={'marginTop': '10px', 'padding': '10px 20px', 'fontSize': '16px'})
        ], style={'width': '80%', 'margin': '0 auto'}),
        
        # Patient info display
        html.Div(id='patient-info', style={'marginTop': '20px', 'textAlign': 'center'}),
        
        # Timeline visualization
        dcc.Graph(id='timeline-graph', style={'height': '600px'})
    ], style={'padding': '20px'})
])

@app.callback(
    [Output('timeline-graph', 'figure'),
     Output('patient-info', 'children')],
    [Input('search-button', 'n_clicks')],
    [State('patient-search', 'value')]
)
def update_graph(n_clicks, patient_id):
    if not patient_id:
        raise PreventUpdate
    
    # Filter data for the selected patient
    df_patient = visits_merged[visits_merged["patient_id"] == patient_id].copy()
    
    if df_patient.empty:
        return {}, f"No data found for patient {patient_id}"
    
    # Sort visits by age_in_days
    df_patient = df_patient.sort_values("age_in_days")
    
    # Map colors for encounter types
    colors = df_patient["encounter_type"].map(color_mapping).fillna("#8c564b")
    
    # Create the figure
    fig = go.Figure()
    
    # Add connecting line
    fig.add_trace(go.Scatter(
        x=df_patient["age_in_days"],
        y=[0] * len(df_patient),
        mode="lines",
        line=dict(color="gray", dash="dash"),
        showlegend=False
    ))
    
    # Add visit markers
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
    
    # Update layout
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
    
    # Update x-axis
    fig.update_xaxes(
        showgrid=True,
        gridcolor="lightgray",
        zeroline=True,
        zerolinecolor="lightgray"
    )
    
    # Create patient info summary
    total_visits = len(df_patient)
    visit_types = df_patient["encounter_type"].value_counts().to_dict()
    visit_summary = ", ".join([f"{k}: {v}" for k, v in visit_types.items()])
    
    patient_info = html.Div([
        html.H3(f"Patient Summary for {patient_id}"),
        html.P(f"Total Visits: {total_visits}"),
        html.P(f"Visit Types: {visit_summary}")
    ])
    
    return fig, patient_info

if __name__ == '__main__':
    app.run_server(debug=True) 