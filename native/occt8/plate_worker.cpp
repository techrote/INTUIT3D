// Pinned OCCT 8.0.1 one-shot plate/cut/STEP worker.
// Invoked only through the isolated, validated native/occt8_bridge.py host.
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <DESTEP_Parameters.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Standard_Failure.hxx>
#include <Standard_Version.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <UnitsMethods_LengthUnit.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <algorithm>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <tuple>
#include <vector>
namespace {
struct Hole { double x,y,r; };
struct Point { double x,y; };
struct RectCut { std::string id; bool circular=false; double x,y,width,depth,cut_depth; };
struct Request {
  std::string request_id,feature_id;
  long long revision=0;
  bool export_step=false,cut_chain=false,mixed_chain=false,l_profile_chain=false,orthogonal_chain=false,linear_chain=false,flex_chain=false;
  double width=0,depth=0,thickness=0,leg_width=0,foot_height=0;
  std::string profile_id;
  std::vector<Hole> holes;
  std::vector<RectCut> cuts;
  std::vector<Point> vertices;
};
struct Metrics {
  int solids=0,shells=0,faces=0; bool valid=false;
  double volume=0,area=0;
  std::vector<Hole> holes;std::vector<double> axes;
};
bool near(double a,double b) {
  return std::isfinite(a)&&std::isfinite(b)&&
    std::abs(a-b)<=std::max(1e-7,std::abs(b)*1e-10);
}
bool id_ok(const std::string& s) {
  if(s.empty()||s.size()>128||!std::isalpha(static_cast<unsigned char>(s[0])))return false;
  for(char c:s)if(!(std::isalnum(static_cast<unsigned char>(c))||
                    c=='.'||c==':'||c=='_'||c=='-'))return false;
  return true;
}

double polygon_area(const std::vector<Point>& v) {
  double result=0;
  for(std::size_t i=0;i<v.size();++i) {
    const auto& a=v[i];const auto& b=v[(i+1)%v.size()];
    result+=a.x*b.y-b.x*a.y;
  }
  return result/2;
}
double polygon_perimeter(const std::vector<Point>& v,bool linear=false) {
  double result=0;
  for(std::size_t i=0;i<v.size();++i) {
    const auto& a=v[i];const auto& b=v[(i+1)%v.size()];
    result+=linear?std::hypot(a.x-b.x,a.y-b.y):
      std::abs(a.x-b.x)+std::abs(a.y-b.y);
  }
  return result;
}
bool intersect_edges(const Point& a,const Point& b,const Point& c,const Point& d) {
  if(a.x==b.x&&c.x==d.x)
    return a.x==c.x&&
      std::max(std::min(a.y,b.y),std::min(c.y,d.y))<=
      std::min(std::max(a.y,b.y),std::max(c.y,d.y));
  if(a.y==b.y&&c.y==d.y)
    return a.y==c.y&&
      std::max(std::min(a.x,b.x),std::min(c.x,d.x))<=
      std::min(std::max(a.x,b.x),std::max(c.x,d.x));
  if(a.x==b.x)
    return std::min(c.x,d.x)<=a.x&&a.x<=std::max(c.x,d.x)&&
      std::min(a.y,b.y)<=c.y&&c.y<=std::max(a.y,b.y);
  return std::min(a.x,b.x)<=c.x&&c.x<=std::max(a.x,b.x)&&
    std::min(c.y,d.y)<=a.y&&a.y<=std::max(c.y,d.y);
}
void validate_polygon(const std::vector<Point>& v) {
  if(v.size()<6||v.size()>64)
    throw std::runtime_error("unsupported selected rectilinear contour size");
  for(std::size_t i=0;i<v.size();++i) {
    const auto& a=v[i];const auto& b=v[(i+1)%v.size()];
    const auto& c=v[(i+2)%v.size()];
    if(!std::isfinite(a.x)||!std::isfinite(a.y)||std::abs(a.x)>1e6||std::abs(a.y)>1e6||
       !((std::abs(b.x-a.x)>=1e-6&&a.y==b.y)||
         (std::abs(b.y-a.y)>=1e-6&&a.x==b.x)))
      throw std::runtime_error("invalid selected orthogonal contour edge");
    if((a.x==b.x)==(b.x==c.x))
      throw std::runtime_error("consecutive collinear profile edges");
    for(std::size_t j=i+1;j<v.size();++j) {
      if(j==i+1||(i==0&&j==v.size()-1))continue;
      if(intersect_edges(a,b,v[j],v[(j+1)%v.size()]))
        throw std::runtime_error("self-intersecting or touching selected profile");
    }
  }
  if(!(polygon_area(v)>1e-6))
    throw std::runtime_error("selected contour must have positive CCW area");
}

double orientation(const Point& a,const Point& b,const Point& c) {
  return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
}
bool on_segment(const Point& a,const Point& b,const Point& p) {
  return orientation(a,b,p)==0 &&
    p.x>=std::min(a.x,b.x)&&p.x<=std::max(a.x,b.x)&&
    p.y>=std::min(a.y,b.y)&&p.y<=std::max(a.y,b.y);
}
bool line_segments_touch(const Point& a,const Point& b,const Point& c,const Point& d) {
  const double x=orientation(a,b,c),y=orientation(a,b,d);
  const double z=orientation(c,d,a),w=orientation(c,d,b);
  return (x==0&&on_segment(a,b,c))||(y==0&&on_segment(a,b,d))||
    (z==0&&on_segment(c,d,a))||(w==0&&on_segment(c,d,b))||
    (x*y<0&&z*w<0);
}
void validate_linear_polygon(const std::vector<Point>& v) {
  if(v.size()<3||v.size()>64)
    throw std::runtime_error("linear profile requires 3..64 vertices");
  for(std::size_t i=0;i<v.size();++i){
    const auto& a=v[i];const auto& b=v[(i+1)%v.size()];
    const auto& c=v[(i+2)%v.size()];
    if(!std::isfinite(a.x)||!std::isfinite(a.y)||
       std::abs(a.x)>1e6||std::abs(a.y)>1e6||
       std::hypot(b.x-a.x,b.y-a.y)<1e-6)
      throw std::runtime_error("invalid linear contour coordinates or edge");
    if(orientation(a,b,c)==0)
      throw std::runtime_error("adjacent collinear linear contour edges");
    for(std::size_t j=i+1;j<v.size();++j){
      if(j==i+1||(i==0&&j==v.size()-1))continue;
      if(line_segments_touch(a,b,v[j],v[(j+1)%v.size()]))
        throw std::runtime_error("self-intersecting or touching linear contour");
    }
  }
  if(!(polygon_area(v)>1e-6))
    throw std::runtime_error("linear contour needs CCW positive area");
}

bool point_inside(const std::vector<Point>& v,double x,double y) {
  bool inside=false;
  for(std::size_t i=0;i<v.size();++i) {
    const auto& a=v[i];const auto& b=v[(i+1)%v.size()];
    if((a.y>y)!=(b.y>y)) {
      const double xedge=a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y);
      if(x<xedge)inside=!inside;
    }
  }
  return inside;
}
bool cut_inside_polygon(const std::vector<Point>& v,const RectCut& c) {
  if(!point_inside(v,c.x,c.y))return false;
  const double rx=c.circular?c.width:c.width/2;
  const double ry=c.circular?c.width:c.depth/2;
  for(std::size_t i=0;i<v.size();++i) {
    const auto& a=v[i];const auto& b=v[(i+1)%v.size()];
    if(a.x==b.x) {
      const double dy=std::max({0.0,std::min(a.y,b.y)-c.y,c.y-std::max(a.y,b.y)});
      if(c.circular) {
        if(std::hypot(c.x-a.x,dy)<=c.width)return false;
      }else if(c.x-rx<=a.x&&a.x<=c.x+rx&&
               std::min(a.y,b.y)<=c.y+ry&&std::max(a.y,b.y)>=c.y-ry)
        return false;
    }else{
      const double dx=std::max({0.0,std::min(a.x,b.x)-c.x,c.x-std::max(a.x,b.x)});
      if(c.circular) {
        if(std::hypot(c.y-a.y,dx)<=c.width)return false;
      }else if(c.y-ry<=a.y&&a.y<=c.y+ry&&
               std::min(a.x,b.x)<=c.x+rx&&std::max(a.x,b.x)>=c.x-rx)
        return false;
    }
  }
  return true;
}


bool linear_cut_inside_polygon(const std::vector<Point>& v,const RectCut& c) {
  if(!point_inside(v,c.x,c.y))return false;
  const double rx=c.width/2,ry=c.depth/2;
  const Point corners[4]={
    {c.x-rx,c.y-ry},{c.x+rx,c.y-ry},
    {c.x+rx,c.y+ry},{c.x-rx,c.y+ry},
  };
  for(std::size_t i=0;i<v.size();++i){
    const auto& a=v[i];const auto& b=v[(i+1)%v.size()];
    if(c.circular){
      const double dx=b.x-a.x,dy=b.y-a.y;
      const double t=std::clamp(((c.x-a.x)*dx+(c.y-a.y)*dy)/
                                (dx*dx+dy*dy),0.0,1.0);
      if(std::hypot(c.x-a.x-t*dx,c.y-a.y-t*dy)<=c.width)return false;
    }else{
      const auto inside_box=[&](const Point& p) {
        return p.x>=c.x-rx&&p.x<=c.x+rx&&
               p.y>=c.y-ry&&p.y<=c.y+ry;
      };
      if(inside_box(a)||inside_box(b))return false;
      for(int j=0;j<4;++j)
        if(line_segments_touch(a,b,corners[j],corners[(j+1)%4]))
          return false;
    }
  }
  return true;
}

Request read_request(const std::filesystem::path& path) {
  std::ifstream file(path);
  std::string magic;Request q;int export_flag=-1,count=-1,cut_count=0;
  if(!(file>>magic)||(magic!="INTUIT3D_OCCT8_PLATE_V1"&&
                      magic!="INTUIT3D_OCCT8_CUT_CHAIN_V1"&&
                      magic!="INTUIT3D_OCCT8_MIXED_CUT_CHAIN_V2"&&
                      magic!="INTUIT3D_OCCT8_L_PROFILE_CHAIN_V3"&&
                      magic!="INTUIT3D_OCCT8_ORTHOGONAL_CHAIN_V4"&&
                      magic!="INTUIT3D_OCCT8_LINEAR_CHAIN_V5"&&
                      magic!="INTUIT3D_OCCT8_FLEX_LINEAR_CHAIN_V6"))
    throw std::runtime_error("invalid canonical request protocol");
  q.mixed_chain=(magic=="INTUIT3D_OCCT8_MIXED_CUT_CHAIN_V2");
  q.l_profile_chain=(magic=="INTUIT3D_OCCT8_L_PROFILE_CHAIN_V3");
  q.orthogonal_chain=(magic=="INTUIT3D_OCCT8_ORTHOGONAL_CHAIN_V4");
  q.linear_chain=(magic=="INTUIT3D_OCCT8_LINEAR_CHAIN_V5");
  q.flex_chain=(magic=="INTUIT3D_OCCT8_FLEX_LINEAR_CHAIN_V6");
  q.cut_chain=(magic!="INTUIT3D_OCCT8_PLATE_V1");
  if(q.orthogonal_chain||q.linear_chain||q.flex_chain) {
    int vertex_count=0;
    if(!(file>>q.request_id>>q.feature_id>>q.revision>>export_flag>>
         q.profile_id>>q.thickness>>vertex_count>>cut_count)||
       vertex_count<((q.linear_chain||q.flex_chain)?3:6)||vertex_count>64)
      throw std::runtime_error("invalid selected orthogonal contour header");
    for(int i=0;i<vertex_count;++i) {
      Point p{};
      if(!(file>>p.x>>p.y))
        throw std::runtime_error("truncated selected contour");
      q.vertices.push_back(p);
    }
    if(q.linear_chain||q.flex_chain)validate_linear_polygon(q.vertices);
    else validate_polygon(q.vertices);
    auto xmin=q.vertices[0].x,xmax=xmin,ymin=q.vertices[0].y,ymax=ymin;
    for(const auto& p:q.vertices) {
      xmin=std::min(xmin,p.x);xmax=std::max(xmax,p.x);
      ymin=std::min(ymin,p.y);ymax=std::max(ymax,p.y);
    }
    q.width=xmax-xmin;q.depth=ymax-ymin;count=0;
  } else if(q.l_profile_chain) {
    if(!(file>>q.request_id>>q.feature_id>>q.revision>>export_flag>>
         q.profile_id>>q.width>>q.depth>>q.thickness>>
         q.leg_width>>q.foot_height>>count>>cut_count))
      throw std::runtime_error("invalid L-profile chain request");
  } else if(!(file>>q.request_id>>q.feature_id>>q.revision>>export_flag>>
                  q.width>>q.depth>>q.thickness>>count)||
            (q.cut_chain && !(file>>cut_count)))
    throw std::runtime_error("invalid canonical request");
  if(!id_ok(q.request_id)||!id_ok(q.feature_id)||q.revision<0||
     export_flag<0||export_flag>1||count<0||count>64||cut_count<0||cut_count>16)
    throw std::runtime_error("invalid request identity or hole count");
  q.export_step=(export_flag==1);
  const auto dimension=[](double v) {return std::isfinite(v)&&v>=1e-6&&v<=1e6;};
  if(!dimension(q.width)||!dimension(q.depth)||!dimension(q.thickness))
    throw std::runtime_error("invalid plate dimensions");
  if((q.orthogonal_chain||q.linear_chain||q.flex_chain) &&
     (!id_ok(q.profile_id)||q.profile_id==q.feature_id||(cut_count<2&&!q.flex_chain)))
    throw std::runtime_error("invalid selected orthogonal profile ID or cuts");
  if(q.l_profile_chain &&
     (!id_ok(q.profile_id)||!dimension(q.leg_width)||!dimension(q.foot_height)||
      q.leg_width>=q.width||q.foot_height>=q.depth||count!=0||cut_count<2))
    throw std::runtime_error("invalid six-edge solved L-profile dimensions or cuts");
  for(int i=0;i<count;++i) {
    Hole h{};
    if(!(file>>h.x>>h.y>>h.r)||!std::isfinite(h.x)||!std::isfinite(h.y)||
       !dimension(h.r)||!(std::abs(h.x)+h.r<q.width/2)||
       !(std::abs(h.y)+h.r<q.depth/2))
      throw std::runtime_error("invalid or tangent hole");
    for(const auto& earlier:q.holes)
      if(std::hypot(h.x-earlier.x,h.y-earlier.y)<=h.r+earlier.r)
        throw std::runtime_error("overlapping holes");
    q.holes.push_back(h);
  }
  // A convex cutter is admitted only if wholly within the vertical leg or
  // the horizontal foot of the L. This conservative v3 profile admission
  // is exact and does not permit a tool to bridge the missing corner.
  const auto inside_l=[&](double x,double y,double rx,double ry) {
    const bool leg=(std::abs(x+q.width/2-q.leg_width/2)+rx<q.leg_width/2 &&
                    std::abs(y)+ry<q.depth/2);
    const bool foot=(std::abs(x)+rx<q.width/2 &&
                     std::abs(y+q.depth/2-q.foot_height/2)+ry<q.foot_height/2);
    return leg||foot;
  };
  // Versioned, explicitly authored rectangular cuts, in execution order.
  // This conservative first C++ slice supports distinct interior blind and
  // through pockets; arbitrary sketch profiles stay in the experimental path.
  for(int i=0;i<cut_count;++i) {
    RectCut c{};
    std::string kind="R";
    if(!(file>>c.id) || ((q.mixed_chain||q.l_profile_chain||q.orthogonal_chain||q.linear_chain||q.flex_chain) && !(file>>kind)) ||
       !(file>>c.x>>c.y>>c.width>>c.depth>>c.cut_depth))
      throw std::runtime_error("truncated ordered cut");
    // The target body is also a feature identity. The Python/Node contract
    // refuses this collision; raw canonical IPC must refuse it independently.
    if(c.id==q.feature_id)
      throw std::runtime_error("cut feature identity conflicts with target body");
    if(kind!="R" && kind!="C")
      throw std::runtime_error("unsupported cut profile kind");
    c.circular=(kind=="C");
    if(!id_ok(c.id)||((q.l_profile_chain||q.orthogonal_chain||q.linear_chain||q.flex_chain)&&c.id==q.profile_id)||!std::isfinite(c.x)||!std::isfinite(c.y)||
       !dimension(c.width)||!dimension(c.cut_depth)||
       (c.circular ? c.depth!=0 : !dimension(c.depth))||
       c.cut_depth>q.thickness||
       ((q.linear_chain||q.flex_chain) ?
         !linear_cut_inside_polygon(q.vertices,c) :
         q.orthogonal_chain ?
         !cut_inside_polygon(q.vertices,c) :
         q.l_profile_chain ?
         !inside_l(c.x,c.y,c.circular?c.width:c.width/2,
                           c.circular?c.width:c.depth/2) :
         (c.circular ?
           !(std::abs(c.x)+c.width<q.width/2 &&
             std::abs(c.y)+c.width<q.depth/2) :
           !(std::abs(c.x)+c.width/2<q.width/2 &&
             std::abs(c.y)+c.depth/2<q.depth/2))))
      throw std::runtime_error("invalid ordered cut extent");
    for(const auto& h:q.holes) {
      const bool touched=c.circular ?
        std::hypot(h.x-c.x,h.y-c.y)<=h.r+c.width :
        std::hypot(std::max(0.0,std::abs(h.x-c.x)-c.width/2),
                   std::max(0.0,std::abs(h.y-c.y)-c.depth/2))<=h.r;
      if(touched)
        throw std::runtime_error("cut touches or intersects an authored bore");
    }
    for(const auto& earlier:q.cuts) {
      if(c.id==earlier.id)
        throw std::runtime_error("duplicate cut feature identity");
      bool touched=false;
      if(c.circular && earlier.circular) {
        touched=std::hypot(c.x-earlier.x,c.y-earlier.y)<=c.width+earlier.width;
      }else if(!c.circular && !earlier.circular) {
        touched=std::abs(c.x-earlier.x)<=(c.width+earlier.width)/2 &&
                std::abs(c.y-earlier.y)<=(c.depth+earlier.depth)/2;
      }else {
        const auto& circle=c.circular?c:earlier;
        const auto& rect=c.circular?earlier:c;
        touched=std::hypot(
          std::max(0.0,std::abs(circle.x-rect.x)-rect.width/2),
          std::max(0.0,std::abs(circle.y-rect.y)-rect.depth/2))<=circle.width;
      }
      if(touched)throw std::runtime_error("cut footprints overlap or touch");
    }
    q.cuts.push_back(c);
  }
  std::string extra;
  if(file>>extra)throw std::runtime_error("trailing request data");
  return q;
}
int count(const TopoDS_Shape& s,TopAbs_ShapeEnum kind) {
  int n=0;for(TopExp_Explorer ex(s,kind);ex.More();ex.Next())++n;return n;
}
Metrics inspect(const TopoDS_Shape& s) {
  if(s.IsNull())throw std::runtime_error("null B-rep");
  Metrics m;
  m.valid=BRepCheck_Analyzer(s).IsValid();
  m.solids=count(s,TopAbs_SOLID);m.shells=count(s,TopAbs_SHELL);
  m.faces=count(s,TopAbs_FACE);
  GProp_GProps v,a;
  BRepGProp::VolumeProperties(s,v);BRepGProp::SurfaceProperties(s,a);
  m.volume=v.Mass();m.area=a.Mass();
  std::vector<std::pair<Hole,double>> found;
  for(TopExp_Explorer ex(s,TopAbs_FACE);ex.More();ex.Next()){
    BRepAdaptor_Surface adaptor(TopoDS::Face(ex.Current()),true);
    if(adaptor.GetType()==GeomAbs_Cylinder){
      auto cylinder=adaptor.Cylinder();
      auto centre=cylinder.Position().Location();
      found.push_back({{centre.X(),centre.Y(),cylinder.Radius()},
                       cylinder.Position().Direction().Z()});
    }else if(adaptor.GetType()!=GeomAbs_Plane)
      throw std::runtime_error("unsupported extra curved face");
  }
  std::sort(found.begin(),found.end(),[](const auto& a,const auto& b) {
    return std::tie(a.first.x,a.first.y,a.first.r)<
           std::tie(b.first.x,b.first.y,b.first.r);
  });
  for(const auto& f:found){m.holes.push_back(f.first);m.axes.push_back(f.second);}
  return m;
}
void require_shape(const Request& q,const Metrics& m) {
  double removed_area=0,bore_wall=0;
  for(const auto& h:q.holes) {
    removed_area+=std::acos(-1.0)*h.r*h.r;
    bore_wall+=2*std::acos(-1.0)*h.r;
  }
  const double stock_area=(q.orthogonal_chain||q.linear_chain||q.flex_chain)?polygon_area(q.vertices):
    q.l_profile_chain ? q.width*q.foot_height+q.leg_width*(q.depth-q.foot_height):
    q.width*q.depth;
  const double stock_perimeter=(q.orthogonal_chain||q.linear_chain||q.flex_chain)?
    polygon_perimeter(q.vertices,(q.linear_chain||q.flex_chain)):2*(q.width+q.depth);
  double v=(stock_area-removed_area)*q.thickness;
  double a=2*(stock_area-removed_area)+
       (stock_perimeter+bore_wall)*q.thickness;
  int expected_faces=((q.orthogonal_chain||q.linear_chain||q.flex_chain)?static_cast<int>(q.vertices.size())+2:
    q.l_profile_chain?8:6)+static_cast<int>(q.holes.size());
  for(const auto& c:q.cuts) {
    const bool through=(c.cut_depth==q.thickness);
    if(c.circular) {
      const double disk=std::acos(-1.0)*c.width*c.width;
      v-=disk*c.cut_depth;
      a+=2*std::acos(-1.0)*c.width*c.cut_depth;
      if(through)a-=2*disk;
      expected_faces+=through?1:2;
    } else {
      v-=c.width*c.depth*c.cut_depth;
      a+=2*(c.width+c.depth)*c.cut_depth;
      if(through)a-=2*c.width*c.depth;
      expected_faces+=through?4:5;
    }
  }
  auto expected=q.holes;
  for(const auto& c:q.cuts)
    if(c.circular)expected.push_back({c.x,c.y,c.width});
  if(!m.valid||m.solids!=1||m.shells!=1||
     m.faces!=expected_faces||
     m.holes.size()!=expected.size()||
     !near(m.volume,v)||!near(m.area,a))
    throw std::runtime_error("B-rep topology or mass does not match plate intent");
  std::sort(expected.begin(),expected.end(),[](const Hole& a,const Hole& b) {
    return std::tie(a.x,a.y,a.r)<std::tie(b.x,b.y,b.r);
  });
  for(std::size_t i=0;i<expected.size();++i){
    const auto& e=expected[i];const auto& h=m.holes[i];
    if(std::abs(e.x-h.x)>std::max(1e-11,std::abs(e.x)*1e-9)||
       std::abs(e.y-h.y)>std::max(1e-11,std::abs(e.y)*1e-9)||
       std::abs(e.r-h.r)>std::max(1e-11,std::abs(e.r)*1e-9)||
       std::abs(std::abs(m.axes[i])-1)>1e-10)
      throw std::runtime_error("cylindrical through-hole was lost or displaced");
  }
}
TopoDS_Shape construct(const Request& q) {
  TopoDS_Shape shape;
  if(q.orthogonal_chain||q.linear_chain||q.flex_chain) {
    // One closed, validated CCW contour. Do not join boxes or infer a sketch.
    BRepBuilderAPI_MakePolygon poly;
    for(const auto& p:q.vertices)poly.Add(gp_Pnt(p.x,p.y,0));
    poly.Close();
    if(!poly.IsDone())throw std::runtime_error("orthogonal contour wire failed");
    BRepBuilderAPI_MakeFace face(poly.Wire());
    if(!face.IsDone())throw std::runtime_error("orthogonal contour face failed");
    BRepPrimAPI_MakePrism prism(face.Face(),gp_Vec(0,0,q.thickness));
    if(!prism.IsDone())throw std::runtime_error("orthogonal extrusion failed");
    shape=prism.Shape();
  }else if(q.l_profile_chain) {
    // These are the six stable vertices of the solved, axis-aligned L sketch.
    // Build a single face and extrude it: no fused-box seam faces.
    BRepBuilderAPI_MakePolygon poly;
    poly.Add(gp_Pnt(-q.width/2,-q.depth/2,0));
    poly.Add(gp_Pnt( q.width/2,-q.depth/2,0));
    poly.Add(gp_Pnt( q.width/2,-q.depth/2+q.foot_height,0));
    poly.Add(gp_Pnt(-q.width/2+q.leg_width,-q.depth/2+q.foot_height,0));
    poly.Add(gp_Pnt(-q.width/2+q.leg_width,q.depth/2,0));
    poly.Add(gp_Pnt(-q.width/2,q.depth/2,0));
    poly.Close();
    if(!poly.IsDone())throw std::runtime_error("L-profile wire construction failed");
    BRepBuilderAPI_MakeFace face(poly.Wire());
    if(!face.IsDone())throw std::runtime_error("L-profile face construction failed");
    BRepPrimAPI_MakePrism prism(face.Face(),gp_Vec(0,0,q.thickness));
    if(!prism.IsDone())throw std::runtime_error("L-profile solid extrusion failed");
    shape=prism.Shape();
  }else{
    shape=BRepPrimAPI_MakeBox(
      gp_Pnt(-q.width/2,-q.depth/2,0),q.width,q.depth,q.thickness).Shape();
  }
  for(const auto& h:q.holes){
    const auto tool=BRepPrimAPI_MakeCylinder(
      gp_Ax2(gp_Pnt(h.x,h.y,-q.thickness),gp_Dir(0,0,1)),
      h.r,3*q.thickness).Shape();
    BRepAlgoAPI_Cut cut(shape,tool);
    cut.SetFuzzyValue(0.0); // Never silently relax modelling tolerance.
    cut.SetRunParallel(false);
    cut.Build();
    if(!cut.IsDone()||cut.HasErrors()||cut.Shape().IsNull())
      throw std::runtime_error("OCCT cut failed");
    shape=cut.Shape();
  }
  for(const auto& c:q.cuts) {
    // Start at the bottom of the authored top-down pocket. An exact through
    // cut has the same bottom plane as the stock; no fuzzy overcut is hidden.
    const auto tool=c.circular ?
      BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(c.x,c.y,q.thickness-c.cut_depth),gp_Dir(0,0,1)),
        c.width,c.cut_depth).Shape() :
      BRepPrimAPI_MakeBox(
        gp_Pnt(c.x-c.width/2,c.y-c.depth/2,q.thickness-c.cut_depth),
        c.width,c.depth,c.cut_depth).Shape();
    BRepAlgoAPI_Cut cut(shape,tool);
    cut.SetFuzzyValue(0.0);
    cut.SetRunParallel(false);
    cut.Build();
    if(!cut.IsDone()||cut.HasErrors()||cut.Shape().IsNull())
      throw std::runtime_error("OCCT ordered rectangular pocket Boolean failed");
    shape=cut.Shape();
  }
  return shape;
}
std::string metrics_json(const Metrics& m) {
  std::ostringstream s;s<<std::setprecision(17)
    <<"{\"valid\":"<<(m.valid?"true":"false")
    <<",\"solidCount\":"<<m.solids
    <<",\"volumeMm3\":"<<m.volume
    <<",\"surfaceAreaMm2\":"<<m.area
    <<",\"cylindricalHoles\":[";
  for(std::size_t i=0;i<m.holes.size();++i){
    if(i)s<<',';
    s<<"{\"x\":"<<m.holes[i].x<<",\"y\":"<<m.holes[i].y
      <<",\"radius\":"<<m.holes[i].r<<",\"axisZ\":"<<m.axes[i]<<"}";
  }
  return s.str()+"]}";
}
void write_report(const Request& q,const Metrics& source,
                  const Metrics* step,const std::filesystem::path& output) {
  // IDs have already been restricted to JSON-safe alphanumeric characters.
  std::ostringstream s;
  s<<"{\"protocol\":\""<<(q.flex_chain?"intuit3d/kernel/flexible-linear-profile-v6":
       q.linear_chain?"intuit3d/kernel/linear-profile-cut-chain-v5":
       q.orthogonal_chain?"intuit3d/kernel/orthogonal-profile-cut-chain-v4":
      q.l_profile_chain?"intuit3d/kernel/l-profile-cut-chain-v3":
     q.mixed_chain?"intuit3d/kernel/plate-mixed-cut-chain-v2":
     q.cut_chain?"intuit3d/kernel/plate-cut-chain-v1":"intuit3d/kernel/plate-v1")<<"\",\"requestId\":\""
   <<q.request_id<<"\",\"featureId\":\""<<q.feature_id
   <<"\",\"revision\":"<<q.revision
   <<",\"backend\":\"OCCT-cxx-8.0.1\",\"occtVersion\":\"8.0.1\""
   <<",\"status\":\"validated_exact\",\"units\":\"mm\",\"source\":"
   <<metrics_json(source)<<",\"stepReadback\":";
  if(step)s<<metrics_json(*step);else s<<"null";
  s<<",\"stepWritten\":"<<(step?"true":"false")<<"}";
  auto pending=output.string()+".pending";
  std::ofstream file(pending,std::ios::binary|std::ios::trunc);
  if(!file||!(file<<s.str()))throw std::runtime_error("response write failed");
  file.close();if(!file)throw std::runtime_error("response flush failed");
  std::filesystem::rename(pending,output);
}
}
int main(int argc,char** argv) {
  try {
    if(argc!=4)throw std::runtime_error("expected: canonical.request response.json step.step");
    if(std::string(OCC_VERSION_COMPLETE)!="8.0.1")
      throw std::runtime_error("not compiled against OCCT 8.0.1");
    auto q=read_request(argv[1]);
    auto shape=construct(q);
    auto src=inspect(shape);require_shape(q,src);
    Metrics rb;Metrics* readback=nullptr;
    if(q.export_step) {
      DESTEP_Parameters p;
      p.WriteUnit=UnitsMethods_LengthUnit_Millimeter;
      STEPControl_Writer writer;
      if(writer.Transfer(shape,STEPControl_ManifoldSolidBrep,p,true)!=IFSelect_RetDone||
         writer.Write(argv[3])!=IFSelect_RetDone)
        throw std::runtime_error("STEP export failed");
      STEPControl_Reader reader;
      if(reader.ReadFile(argv[3])!=IFSelect_RetDone||reader.TransferRoots()!=1)
        throw std::runtime_error("same-engine STEP reimport failed");
      rb=inspect(reader.OneShape());require_shape(q,rb);readback=&rb;
    }
    write_report(q,src,readback,argv[2]);
    return 0;
  }catch(const Standard_Failure& e) {
    std::cerr<<"OCCT worker: "<<e.GetMessageString()<<'\n';return 2;
  }catch(const std::exception& e) {
    std::cerr<<"OCCT worker: "<<e.what()<<'\n';return 2;
  }
}
