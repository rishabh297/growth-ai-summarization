import dash
from dash import html, dcc, Input, Output, State
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from dash.exceptions import PreventUpdate
import numpy as np

# Initialize the Dash app
app = dash.Dash(__name__)

# Load the aggregated data
visits_merged = pd.read_csv("/Users/rishabhgoel/Desktop/Harvard/Zak Lab/P3 Project/combined_visits_aggregated_dec_summarize_2025.csv")

# Define a professional color scheme
color_mapping = {
    "Office Visit": "#2ecc71",  # Green
    "Consult": "#3498db",      # Blue
    "Well Visit (Conv.)": "#9b59b6",  # Purple
    "Telemedicine": "#e74c3c",  # Red
    "Telephone": "#f1c40f"     # Yellow
}

# Define a professional theme
THEME = {
    'background': '#ffffff',
    'text': '#2c3e50',
    'primary': '#3498db',
    'secondary': '#2ecc71',
    'accent': '#e74c3c'
}

# Create the layout
app.layout = html.Div([
    # Header
    html.Div([
        html.H1("Patient Journey Dashboard", 
                style={'textAlign': 'center', 'color': THEME['text'], 'marginBottom': 30}),
        html.P("Track patient progress and healthcare interactions over time",
               style={'textAlign': 'center', 'color': '#7f8c8d', 'marginBottom': 30})
    ], style={'backgroundColor': '#f8f9fa', 'padding': '20px', 'borderRadius': '10px'}),
    
    # Search and Patient Info Section
    html.Div([
        # Search box
        html.Div([
            dcc.Input(
                id='patient-search',
                type='text',
                placeholder='Enter Patient ID (e.g., P0013508)',
                style={'width': '100%', 'padding': '12px', 'fontSize': '16px', 'borderRadius': '5px', 'border': '1px solid #ddd'}
            ),
            html.Button('Search Patient', id='search-button', n_clicks=0,
                       style={'marginTop': '10px', 'padding': '12px 24px', 'fontSize': '16px',
                             'backgroundColor': THEME['primary'], 'color': 'white', 'border': 'none',
                             'borderRadius': '5px', 'cursor': 'pointer'})
        ], style={'width': '80%', 'margin': '0 auto'}),
        
        # Patient Summary Cards
        html.Div(id='patient-info', style={'marginTop': '30px'})
    ], style={'padding': '20px'}),
    
    # Main Content Grid
    html.Div([
        # Left Column - Timeline and Visit Distribution
        html.Div([
            # Timeline
            html.Div([
                html.H3("Patient Journey Timeline", style={'color': THEME['text']}),
                dcc.Graph(id='timeline-graph', style={'height': '400px'})
            ], style={'backgroundColor': 'white', 'padding': '20px', 'borderRadius': '10px', 'boxShadow': '0 2px 4px rgba(0,0,0,0.1)'}),
            
            # Visit Distribution
            html.Div([
                html.H3("Visit Type Distribution", style={'color': THEME['text']}),
                dcc.Graph(id='visit-distribution', style={'height': '300px'})
            ], style={'backgroundColor': 'white', 'padding': '20px', 'marginTop': '20px', 'borderRadius': '10px', 'boxShadow': '0 2px 4px rgba(0,0,0,0.1)'})
        ], style={'width': '60%', 'float': 'left', 'padding': '20px'}),
        
        # Right Column - Visit Details and Statistics
        html.Div([
            # Visit Details Table
            html.Div([
                html.H3("Visit Details", style={'color': THEME['text']}),
                html.Div(id='visit-details-table')
            ], style={'backgroundColor': 'white', 'padding': '20px', 'borderRadius': '10px', 'boxShadow': '0 2px 4px rgba(0,0,0,0.1)'}),
            
            # Visit Statistics
            html.Div([
                html.H3("Visit Statistics", style={'color': THEME['text']}),
                html.Div(id='visit-statistics')
            ], style={'backgroundColor': 'white', 'padding': '20px', 'marginTop': '20px', 'borderRadius': '10px', 'boxShadow': '0 2px 4px rgba(0,0,0,0.1)'})
        ], style={'width': '40%', 'float': 'right', 'padding': '20px'})
    ], style={'display': 'flex'})
], style={'backgroundColor': '#f8f9fa', 'minHeight': '100vh'})

@app.callback(
    [Output('timeline-graph', 'figure'),
     Output('visit-distribution', 'figure'),
     Output('visit-details-table', 'children'),
     Output('visit-statistics', 'children'),
     Output('patient-info', 'children')],
    [Input('search-button', 'n_clicks')],
    [State('patient-search', 'value')]
)
def update_dashboard(n_clicks, patient_id):
    if not patient_id:
        raise PreventUpdate
    
    # Filter data for the selected patient
    df_patient = visits_merged[visits_merged["patient_id"] == patient_id].copy()
    
    if df_patient.empty:
        return {}, {}, html.Div("No data found"), html.Div("No data found"), html.Div("No data found")
    
    # Sort visits by age_in_days
    df_patient = df_patient.sort_values("age_in_days")
    
    # Create Timeline
    colors = df_patient["encounter_type"].map(color_mapping).fillna("#8c564b")
    
    fig_timeline = go.Figure()
    
    # Add connecting line
    fig_timeline.add_trace(go.Scatter(
        x=df_patient["age_in_days"],
        y=[0] * len(df_patient),
        mode="lines",
        line=dict(color="#bdc3c7", dash="dash"),
        showlegend=False
    ))
    
    # Add visit markers
    fig_timeline.add_trace(go.Scatter(
        x=df_patient["age_in_days"],
        y=[0] * len(df_patient),
        mode="markers",
        marker=dict(
            size=15,
            symbol="circle",
            color=colors,
            line=dict(width=2, color="white")
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
    
    fig_timeline.update_layout(
        template="simple_white",
        title={
            'text': f"<b>Patient Journey Timeline</b>",
            'x': 0.5,
            'xanchor': 'center'
        },
        xaxis_title="Age in Days",
        yaxis=dict(visible=False),
        hovermode="closest",
        margin=dict(l=40, r=40, t=60, b=40),
        font=dict(family="Arial, sans-serif", size=12, color=THEME['text']),
        showlegend=False,
        plot_bgcolor='white',
        paper_bgcolor='white'
    )
    
    # Create Visit Distribution
    visit_counts = df_patient["encounter_type"].value_counts()
    fig_distribution = px.pie(
        values=visit_counts.values,
        names=visit_counts.index,
        color=visit_counts.index,
        color_discrete_map=color_mapping,
        title="Distribution of Visit Types"
    )
    
    fig_distribution.update_layout(
        font=dict(family="Arial, sans-serif", size=12, color=THEME['text']),
        plot_bgcolor='white',
        paper_bgcolor='white'
    )
    
    # Create Visit Details Table
    visit_details = []
    for _, row in df_patient.iterrows():
        visit_details.append(html.Div([
            html.H4(f"Visit {row['visit_id']} - {row['encounter_type']}", 
                   style={'color': color_mapping.get(row['encounter_type'], '#8c564b')}),
            html.P(f"Age: {row['age_in_days']} days"),
            html.P(f"Medications: {row['medications_details']}"),
            html.P(f"Labs: {row['labs_details']}"),
            html.P(f"Problems: {row['patient_problems']}"),
            html.Hr()
        ]))
    
    # Create Visit Statistics
    total_visits = len(df_patient)
    visit_types = df_patient["encounter_type"].value_counts().to_dict()
    avg_visit_interval = np.mean(df_patient["age_in_days"].diff().dropna())
    
    statistics = html.Div([
        html.Div([
            html.H4("Key Statistics", style={'color': THEME['text']}),
            html.P(f"Total Visits: {total_visits}"),
            html.P(f"Average Time Between Visits: {avg_visit_interval:.1f} days"),
            html.P("Visit Type Breakdown:"),
            html.Ul([html.Li(f"{k}: {v} visits") for k, v in visit_types.items()])
        ])
    ])
    
    # Create Patient Info Summary
    patient_info = html.Div([
        html.Div([
            html.H3(f"Patient {patient_id}", style={'color': THEME['text']}),
            html.P(f"Total Visits: {total_visits}"),
            html.P(f"First Visit: {df_patient['age_in_days'].min()} days"),
            html.P(f"Last Visit: {df_patient['age_in_days'].max()} days"),
            html.P(f"Follow-up Period: {df_patient['age_in_days'].max() - df_patient['age_in_days'].min()} days")
        ], style={'backgroundColor': 'white', 'padding': '20px', 'borderRadius': '10px', 'boxShadow': '0 2px 4px rgba(0,0,0,0.1)'})
    ])
    
    return fig_timeline, fig_distribution, visit_details, statistics, patient_info

if __name__ == '__main__':
    app.run_server(debug=True) 